import http from 'node:http';
import type { AppConfig } from '../config.js';
import type { Transport } from '../core/types.js';
export declare function setTransportGetter(fn: () => Transport): void;
export declare function createHttpServer(config: AppConfig): http.Server;
