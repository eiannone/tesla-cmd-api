import fs from 'fs';
import { FleetApi } from '../src/FleetApi.js';

const cfg = JSON.parse(fs.readFileSync('oauth.json'));
const fleetApi = new FleetApi(cfg.client_id, cfg.access_token, cfg.refresh_token);

const resp = await fleetApi.refreshToken(cfg.refresh_token);
if (resp.hasOwnProperty('access_token') && resp.hasOwnProperty('access_token')) {
    cfg.access_token = resp.access_token;
    cfg.refresh_token = resp.refresh_token;
    fs.writeFileSync('pippo.json', JSON.stringify(cfg, null, 4), 'utf-8');
    console.log('OAUth tokens updated');
}
else {
    console.log('Invalid response');
    console.log(resp);
}
