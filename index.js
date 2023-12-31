import fs from 'fs';
import eckey from 'eckey-utils';
import { FleetApi } from './src/FleetApi.js';
import { CarServer } from './src/CarServer.js';

// Load OAuth tokens
const cfg = JSON.parse(fs.readFileSync('oauth.json'));

// Load private and public keys
const key = eckey.parsePem(fs.readFileSync('private_key.pem', 'utf8').trim());

// Fleet api config
const fleetApi = new FleetApi(cfg.client_id, cfg.access_token, cfg.refresh_token);

// CarServer initialization
const cmdApi = new CarServer(fleetApi, cfg.vin, key);

await cmdApi.startSession();
await cmdApi.chargingSetLimit(80);
