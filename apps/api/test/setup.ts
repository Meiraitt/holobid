import 'reflect-metadata';
import process from 'node:process';

process.env.NODE_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
process.env.PORT = '3000';
