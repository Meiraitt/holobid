import { AuctionEvents } from '../src/modules/auctions/auction-events';
import { AuctionScheduler } from '../src/modules/settlements/auction-scheduler';

describe('Scheduler timing and bounded recovery', () => {
  let jobs: AuctionScheduler;
  const events = new AuctionEvents();
  const repo = { pendingPage: jest.fn(), schedule: jest.fn() };
  const anchors = { pendingPage: jest.fn(), pendingForAuction: jest.fn() };
  const settlement = { settle: jest.fn() };
  const audit = { reconcile: jest.fn() };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    repo.pendingPage.mockResolvedValue([]);
    anchors.pendingPage.mockResolvedValue([]);
    anchors.pendingForAuction.mockResolvedValue(null);
    jobs = new AuctionScheduler(
      { get: () => 'test' } as never,
      repo as never,
      settlement as never,
      audit as never,
      anchors as never,
      { now: () => new Date() },
      events,
    );
  });
  afterEach(async () => {
    await jobs.beforeApplicationShutdown();
    jest.useRealTimers();
  });
  it('does not poll databases each minute and stops all timers at shutdown', async () => {
    await jobs.start();
    expect(repo.pendingPage).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(14 * 60_000);
    expect(repo.pendingPage).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(repo.pendingPage).toHaveBeenCalledTimes(2);
    await jobs.beforeApplicationShutdown();
    expect(jest.getTimerCount()).toBe(0);
  });
  it('retries unavailable startup only three times before the periodic pass', async () => {
    anchors.pendingPage.mockRejectedValue(new Error('Offline'));
    await jobs.start();
    await jest.advanceTimersByTimeAsync(36_000);
    expect(anchors.pendingPage).toHaveBeenCalledTimes(4);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(anchors.pendingPage).toHaveBeenCalledTimes(4);
  });
  it('caps long timers and reloads updated deadlines on signals', async () => {
    await jobs.start();

    const now = Date.now();

    repo.schedule.mockResolvedValue({
      id: 'lot',
      startsAt: new Date(now + 40 * 86400_000),
      endsAt: new Date(now + 41 * 86400_000),
      lifecycle: 'OPEN',
      settlementStatus: 'NOT_DUE',
    });
    await jobs.refresh('lot');
    await jest.advanceTimersByTimeAsync(1000);
    expect(settlement.settle).not.toHaveBeenCalled();
    repo.schedule.mockResolvedValue({
      id: 'lot',
      startsAt: new Date(now),
      endsAt: new Date(Date.now() + 1000),
      lifecycle: 'OPEN',
      settlementStatus: 'NOT_DUE',
    });
    settlement.settle.mockResolvedValue('COMPLETED');
    events.publish({ auctionId: 'lot', reason: 'BID_ACCEPTED' });
    await jest.advanceTimersByTimeAsync(1001);
    expect(settlement.settle).toHaveBeenCalledWith('lot');
  });
});
