import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { AuditDatabaseService } from '../../src/database/audit-database.service';
import { DatabaseService, TransactionContext } from '../../src/database/database.service';
import { AuditService } from '../../src/modules/audit/audit.service';
import { AuditSnapshot, snapshotHead } from '../../src/modules/audit/audit.types';
import { AuditAnchorRepository } from '../../src/modules/audit/audit-anchor.repository';
import { AuditChainService } from '../../src/modules/audit/audit-chain.service';
import { AuditCrypto } from '../../src/modules/audit/audit-crypto.service';
import { AuditProtocolService } from '../../src/modules/audit/audit-protocol.service';
import { AuditSourceRepository } from '../../src/modules/audit/audit-source.repository';
import { MediaRepository } from '../../src/modules/media/media.repository';

if (process.env.HOLOBID_ISOLATED_DATABASE_TEST !== '1') {
  throw new Error('Run npm run test:db.');
}

const bytes = readFileSync(join(__dirname, '../../fixtures/tcgdex/base1-58.webp'));

describe('Authenticated audit and cross-database recovery', () => {
  let app: INestApplicationContext;
  let db: DatabaseService;
  let auditDb: AuditDatabaseService;
  let crypto: AuditCrypto;
  let audit: AuditService;
  let anchors: AuditAnchorRepository;
  let source: AuditSourceRepository;
  let protocol: AuditProtocolService;
  let sellerId: string;
  let bidderId: string;

  async function boot() {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await app.init();
    db = app.get(DatabaseService);
    auditDb = app.get(AuditDatabaseService);
    crypto = app.get(AuditCrypto);
    audit = app.get(AuditService);
    anchors = app.get(AuditAnchorRepository);
    source = app.get(AuditSourceRepository);
    protocol = app.get(AuditProtocolService);
  }

  beforeAll(async () => {
    await boot();
    sellerId = (
      await db.client.user.create({
        data: {
          email: `${randomUUID()}@example.test`,
          passwordHash: 'fixture',
          role: 'AUCTIONEER',
          wallet: { create: {} },
        },
      })
    ).id;
    bidderId = (
      await db.client.user.create({
        data: {
          email: `${randomUUID()}@example.test`,
          passwordHash: 'fixture',
          wallet: { create: {} },
        },
      })
    ).id;
  });
  afterAll(async () => {
    await app.close();
  });

  async function operation(tx: TransactionContext, id: string, resourceId: string) {
    await tx.idempotencyRecord.create({
      data: {
        id,
        userId: sellerId,
        operation: 'TEST:audited',
        key: randomUUID(),
        requestHash: crypto.digest({ resourceId }),
        resourceId,
        state: 'COMPLETED',
        responseStatus: 201,
        response: { resourceId },
      },
    });
  }

  async function createRows(tx: TransactionContext, id: string, operationKey: string) {
    await source.lock(id, tx);

    const image = await app
      .get(MediaRepository)
      .store(
        { bytes, mimeType: 'image/webp', sha256: createHash('sha256').update(bytes).digest('hex') },
        tx,
      );
    const item = await tx.catalogSnapshot.create({
      data: {
        externalId: 'base1-58',
        language: 'en',
        title: 'Pikachu',
        setId: 'base1',
        setName: 'Base Set',
        cardNumber: '58',
        fetchedAt: new Date(),
      },
    });

    await tx.auction.create({
      data: {
        id,
        sellerId,
        snapshotId: item.id,
        imageId: image.id,
        startingPriceCents: 100n,
        minimumIncrementCents: 10n,
        startsAt: new Date(Date.now() - 60_000),
        originalEndsAt: new Date(Date.now() + 3600_000),
        endsAt: new Date(Date.now() + 3600_000),
        auditHead: '0'.repeat(64),
        auditMac: '0'.repeat(64),
      },
    });

    const snapshot = (await source.read(id, tx))!;
    const head = crypto.genesis(snapshot);

    await tx.auction.update({
      where: { id },
      data: { auditHead: head.hash, auditMac: head.mac, endsAt: snapshot.originalEndsAt },
    });
    await operation(tx, operationKey, id);
  }

  async function publish(
    operationKey = randomUUID(),
    id = randomUUID(),
    afterPrepare?: () => void,
  ) {
    const result = await protocol.run(operationKey, async (tx, prepare) => {
      await createRows(tx, id, operationKey);
      await prepare(id, null);
      afterPrepare?.();

      return id;
    });

    return { ...result, id, operationKey };
  }

  async function append(id: string) {
    const operationKey = randomUUID();
    const bidId = randomUUID();
    const result = await protocol.run(operationKey, async (tx, prepare) => {
      const previous = (await audit.lockedSnapshot(id, tx))!;
      const expected = await audit.requireConfirmed(previous);
      const bid = {
        id: bidId,
        auctionId: id,
        bidderId,
        sequence: previous.bidCount + 1,
        amountCents: BigInt(100 + previous.bidCount * 10),
        acceptedAt: new Date(),
        endsAtAfter: previous.endsAt,
        previousHash: previous.auditHead,
      };
      const signed = crypto.bid(bid);

      await audit.assertPseudonymAvailable(id, bidderId, tx);
      await tx.bid.create({ data: { ...bid, ...signed } });
      await tx.auction.update({
        where: { id },
        data: {
          currentBidId: bidId,
          bidCount: bid.sequence,
          auditHead: signed.hash,
          auditMac: signed.mac,
          version: { increment: 1 },
        },
      });
      await operation(tx, operationKey, bidId);
      await prepare(id, expected);

      return bidId;
    });

    return { ...result, operationKey, bidId };
  }

  function snapshot(id: string) {
    return db.transaction((tx) => source.read(id, tx)) as Promise<AuditSnapshot>;
  }

  it('confirms genesis and a full chain with independent checkpoints and deterministic hashes', async () => {
    const created = await publish();

    expect(created.confirmation).toBe('CONFIRMED');
    expect((await audit.verify(created.id)).integrity).toBe('VERIFIED');
    await append(created.id);
    await append(created.id);

    const data = await snapshot(created.id);

    expect(crypto.genesis(data)).toEqual(crypto.genesis(structuredClone(data)));
    expect(await audit.verify(created.id)).toMatchObject({
      integrity: 'VERIFIED',
      expectedCount: 2,
      actualCount: 2,
      verifiedThroughSequence: 2,
    });
    expect(
      await auditDb.client.auditCheckpoint.findUnique({ where: { auctionId: created.id } }),
    ).toMatchObject({ sequence: 2, headHash: data.auditHead });
    expect(
      await auditDb.client.auditIntent.count({
        where: { auctionId: created.id, state: 'COMMITTED' },
      }),
    ).toBe(3);
  });
  it.each([
    'amount',
    'bidder',
    'timestamp',
    'hash',
    'mac',
    'pseudonym',
    'snapshot',
    'rules',
    'order',
    'fake-middle',
    'fake-tail',
    'first',
    'middle',
    'last',
  ] as const)('detects %s tampering and isolates other auctions', async (change) => {
    const created = await publish();

    await append(created.id);
    await append(created.id);
    await append(created.id);

    const original = await snapshot(created.id);
    const bid = original.bids[1]!;

    if (change === 'amount') {
      await db.client.bid.update({ where: { id: bid.id }, data: { amountCents: 999n } });
    }

    if (change === 'bidder') {
      await db.client.bid.update({ where: { id: bid.id }, data: { bidderId: sellerId } });
    }

    if (change === 'timestamp') {
      await db.client.bid.update({
        where: { id: bid.id },
        data: { acceptedAt: new Date(bid.acceptedAt.getTime() + 1) },
      });
    }

    if (change === 'hash') {
      await db.client.bid.update({
        where: { id: bid.id },
        data: { amountCents: 999n, hash: crypto.bid({ ...bid, amountCents: 999n }).hash },
      });
    }

    if (change === 'mac') {
      await db.client.bid.update({ where: { id: bid.id }, data: { mac: 'f'.repeat(64) } });
    }

    if (change === 'pseudonym') {
      await db.client.bid.update({ where: { id: bid.id }, data: { pseudonym: '0'.repeat(16) } });
    }

    if (change === 'snapshot') {
      await db.client.catalogSnapshot.update({
        where: { id: original.snapshotId },
        data: { title: 'Altered' },
      });
    }

    if (change === 'rules') {
      await db.client.auction.update({
        where: { id: created.id },
        data: { minimumIncrementCents: 11n },
      });
    }

    if (change === 'order') {
      await db.transaction(async (tx) => {
        await tx.bid.update({ where: { id: original.bids[0]!.id }, data: { sequence: 99 } });
        await tx.bid.update({ where: { id: bid.id }, data: { sequence: 1 } });
        await tx.bid.update({ where: { id: original.bids[0]!.id }, data: { sequence: 2 } });
      });
    }

    if (change === 'fake-tail') {
      await db.client.bid.create({
        data: { ...bid, id: randomUUID(), sequence: 4, previousHash: original.auditHead },
      });
    }

    if (change === 'fake-middle') {
      await db.transaction(async (tx) => {
        await tx.bid.update({ where: { id: original.bids[2]!.id }, data: { sequence: 4 } });
        await tx.bid.update({ where: { id: bid.id }, data: { sequence: 3 } });
        await tx.bid.create({
          data: {
            ...bid,
            id: randomUUID(),
            sequence: 2,
            acceptedAt: new Date(
              Math.floor((original.bids[0]!.acceptedAt.getTime() + bid.acceptedAt.getTime()) / 2),
            ),
          },
        });
      });
    }

    if (['first', 'middle', 'last'].includes(change)) {
      const target =
        change === 'first' ? original.bids[0]! : change === 'middle' ? bid : original.bids[2]!;

      if (change === 'last') {
        await db.client.auction.update({
          where: { id: created.id },
          data: { currentBidId: bid.id },
        });
      }

      await db.client.bid.delete({ where: { id: target.id } });
    }

    expect((await audit.verify(created.id)).integrity).toBe('TAMPERED');

    const other = await publish();

    expect((await audit.verify(other.id)).integrity).toBe('VERIFIED');
  });
  it('detects media tampering and becomes valid again when exact original bytes are restored', async () => {
    const created = await publish();
    const original = await snapshot(created.id);
    const altered = Buffer.from(bytes);

    altered[100] = altered[100]! ^ 1;
    try {
      await db.client.mediaAsset.update({
        where: { id: original.imageId },
        data: { bytes: altered },
      });
      expect((await audit.verify(created.id)).reasonCode).toBe('IMAGE_MISMATCH');
    } finally {
      await db.client.mediaAsset.update({ where: { id: original.imageId }, data: { bytes } });
    }

    expect((await audit.verify(created.id)).integrity).toBe('VERIFIED');
  });
  it('detects a complete rollback to an earlier valid main history and deletion of all bids', async () => {
    const created = await publish();

    await append(created.id);

    const earlier = await snapshot(created.id);

    await append(created.id);
    await db.transaction(async (tx) => {
      await tx.auction.update({
        where: { id: created.id },
        data: {
          bidCount: earlier.bidCount,
          currentBidId: earlier.currentBidId,
          auditHead: earlier.auditHead,
          auditMac: earlier.auditMac,
          version: earlier.version,
        },
      });
      await tx.bid.deleteMany({
        where: { auctionId: created.id, sequence: { gt: earlier.bidCount } },
      });
    });
    expect(app.get(AuditChainService).verify(await snapshot(created.id)).integrity).toBe(
      'VERIFIED',
    );
    expect((await audit.verify(created.id)).reasonCode).toBe('ANCHOR_MISMATCH');

    const root = crypto.genesis(earlier);

    await db.transaction(async (tx) => {
      await tx.auction.update({
        where: { id: created.id },
        data: {
          bidCount: 0,
          currentBidId: null,
          auditHead: root.hash,
          auditMac: root.mac,
          endsAt: earlier.originalEndsAt,
        },
      });
      await tx.bid.deleteMany({ where: { auctionId: created.id } });
    });
    expect((await audit.verify(created.id)).reasonCode).toBe('ANCHOR_MISMATCH');
  });
  it('reports incomplete for unavailable keys/anchors and detects deletion of the main auction', async () => {
    const created = await publish();

    await db.client.auction.update({ where: { id: created.id }, data: { auditKeyId: 'old-key' } });
    expect((await audit.verify(created.id)).integrity).toBe('INCOMPLETE');
    await db.client.auction.delete({ where: { id: created.id } });
    expect((await audit.verify(created.id)).reasonCode).toBe('MAIN_HISTORY_MISSING');
    jest.spyOn(anchors, 'read').mockRejectedValueOnce(new Error('Private connection details'));
    expect(await audit.verify(created.id)).toMatchObject({
      integrity: 'INCOMPLETE',
      reasonCode: 'DEPENDENCY_UNAVAILABLE',
    });
  });
  it('checks pseudonym collisions before accepting another identity', async () => {
    const created = await publish();

    await append(created.id);

    const pseudonym = crypto.pseudonym(created.id, bidderId);

    jest.spyOn(crypto, 'pseudonym').mockReturnValue(pseudonym);
    await expect(
      db.transaction((tx) => audit.assertPseudonymAvailable(created.id, sellerId, tx)),
    ).rejects.toMatchObject({ code: 'AUDIT_TAMPERED' });
  });
  it('rolls back when preparation fails before the main commit', async () => {
    const id = randomUUID();
    const key = randomUUID();

    jest.spyOn(anchors, 'prepare').mockRejectedValueOnce(new Error('Anchor offline'));
    await expect(publish(key, id)).rejects.toMatchObject({ code: 'AUDIT_UNAVAILABLE' });
    expect(await db.client.auction.findUnique({ where: { id } })).toBeNull();
    expect(await db.client.idempotencyRecord.findUnique({ where: { id: key } })).toBeNull();
  });
  it('aborts a known rollback, including a lost prepare acknowledgement, and permits a retry', async () => {
    const key = randomUUID();
    const id = randomUUID();
    const prepare = anchors.prepare.bind(anchors);

    jest.spyOn(anchors, 'prepare').mockImplementationOnce(async (proposal) => {
      await prepare(proposal);
      throw new Error('Lost prepare acknowledgement');
    });
    await expect(publish(key, id)).rejects.toMatchObject({ code: 'AUDIT_UNAVAILABLE' });
    expect(await anchors.findOperation(key)).toMatchObject({ state: 'ABORTED' });
    expect(await db.client.auction.findUnique({ where: { id } })).toBeNull();
    expect((await publish(key)).confirmation).toBe('CONFIRMED');

    const second = randomUUID();

    await expect(
      publish(second, randomUUID(), () => {
        throw new Error('Failure after prepare');
      }),
    ).rejects.toThrow('Failure after prepare');
    expect(await anchors.findOperation(second)).toMatchObject({ state: 'ABORTED' });
  });
  it('never aborts an older uncertain attempt during a retry', async () => {
    const key = randomUUID();
    const id = randomUUID();

    jest.spyOn(anchors, 'abortKnownRollback').mockRejectedValueOnce(new Error('Abort unavailable'));
    await expect(
      publish(key, id, () => {
        throw new Error('Main rollback');
      }),
    ).rejects.toThrow('Main rollback');

    const original = await anchors.findOperation(key);

    expect(original!.state).toBe('PREPARED');
    await expect(publish(key)).rejects.toMatchObject({ code: 'AUDIT_PENDING' });
    expect((await anchors.findOperation(key))!.id).toBe(original!.id);
    expect((await anchors.findOperation(key))!.state).toBe('PREPARED');
    expect(await audit.reconcile(key)).toBe('PENDING');
    expect((await audit.verify(id)).integrity).toBe('INCOMPLETE');
  });
  it('recovers after commit confirmation fails, across restart, without duplicating writes', async () => {
    jest.spyOn(anchors, 'commit').mockRejectedValueOnce(new Error('Anchor commit unavailable'));

    const created = await publish();

    expect(created.confirmation).toBe('PENDING');
    expect((await audit.verify(created.id)).integrity).toBe('INCOMPLETE');
    await app.close();
    await boot();
    expect(await audit.reconcile(created.operationKey)).toBe('CONFIRMED');
    expect(await audit.reconcile(created.operationKey)).toBe('CONFIRMED');
    expect((await audit.verify(created.id)).integrity).toBe('VERIFIED');
    expect(await db.client.auction.count({ where: { id: created.id } })).toBe(1);
  });
  it('handles lost acknowledgements of both primary and anchor commits conservatively', async () => {
    const commit = anchors.commit.bind(anchors);

    jest.spyOn(anchors, 'commit').mockImplementationOnce(async (key) => {
      await commit(key);
      throw new Error('Lost anchor acknowledgement');
    });

    const first = await publish();

    expect(first.confirmation).toBe('PENDING');
    expect(await audit.reconcile(first.operationKey)).toBe('CONFIRMED');

    const transaction = db.transaction.bind(db);

    jest.spyOn(db, 'transaction').mockImplementationOnce(async (work) => {
      await transaction(work);
      throw new Error('Lost main acknowledgement');
    });

    const second = await publish();

    expect(second.confirmation).toBe('PENDING');
    expect(await audit.reconcile(second.operationKey)).toBe('CONFIRMED');
  });
  it('recognizes another worker confirming an intent while reconciliation waits', async () => {
    jest
      .spyOn(anchors, 'commit')
      .mockRejectedValueOnce(new Error('Anchor acknowledgement unavailable'));

    const created = await publish();

    expect(created.confirmation).toBe('PENDING');

    const find = anchors.findOperation.bind(anchors);

    jest.spyOn(anchors, 'findOperation').mockImplementationOnce(async (key) => {
      const pending = await find(key);

      await anchors.commit(key);

      return pending;
    });
    expect(await audit.reconcile(created.operationKey)).toBe('CONFIRMED');
  });
  it('retains an ambiguous absent main commit instead of assuming rollback', async () => {
    const transaction = db.transaction.bind(db);

    jest.spyOn(db, 'transaction').mockImplementationOnce((work) =>
      transaction(async (tx) => {
        await work(tx);
        throw new Error('Commit outcome unknown');
      }),
    );

    const created = await publish();

    expect(created.confirmation).toBe('PENDING');
    expect(await db.client.auction.findUnique({ where: { id: created.id } })).toBeNull();
    expect(await audit.reconcile(created.operationKey)).toBe('PENDING');
    expect((await anchors.findOperation(created.operationKey))!.state).toBe('PREPARED');
  });
  it.each(['operation', 'ledger', 'reservation'] as const)(
    'refuses recovery when %s evidence was changed',
    async (change) => {
      const created = await publish();

      jest.spyOn(anchors, 'commit').mockRejectedValueOnce(new Error('Confirmation unavailable'));

      const bid = await append(created.id);

      expect(bid.confirmation).toBe('PENDING');
      if (change === 'operation') {
        await db.client.idempotencyRecord.update({
          where: { id: bid.operationKey },
          data: { response: { forged: true } },
        });
      }

      if (change === 'ledger') {
        await db.client.walletEntry.create({
          data: {
            userId: bidderId,
            type: 'DEPOSIT',
            reference: bid.bidId,
            totalDeltaCents: 1n,
            reservedDeltaCents: 0n,
          },
        });
      }

      if (change === 'reservation') {
        await db.client.reservation.create({
          data: { auctionId: created.id, bidId: bid.bidId, userId: bidderId, amountCents: 100n },
        });
      }

      expect(await audit.reconcile(bid.operationKey)).toBe('PENDING');
      expect((await audit.verify(created.id)).integrity).toBe('INCOMPLETE');
      await expect(append(created.id)).rejects.toMatchObject({ code: 'AUDIT_PENDING' });
    },
  );
  it('uses CAS, idempotent confirmation and consistent reads during legitimate writes', async () => {
    const created = await publish();
    const before = await snapshot(created.id);
    const results = await Promise.all([
      append(created.id),
      ...Array.from({ length: 5 }, () => audit.verify(created.id)),
    ]);

    for (const result of results.slice(1)) {
      expect(['VERIFIED', 'INCOMPLETE']).toContain((result as { integrity: string }).integrity);
    }

    expect((await audit.verify(created.id)).integrity).toBe('VERIFIED');

    const current = await snapshot(created.id);

    await expect(
      anchors.prepare({
        attemptId: randomUUID(),
        operationKey: randomUUID(),
        auctionId: created.id,
        expected: snapshotHead(before),
        next: { ...snapshotHead(current), sequence: 2 },
        proofHash: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'AUDIT_TAMPERED' });

    const committed = await anchors.findOperation(created.operationKey);

    await anchors.commit(created.operationKey);
    expect(await anchors.findOperation(created.operationKey)).toEqual(committed);
  });
});
