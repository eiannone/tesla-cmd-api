import axios from 'axios';

class ApiError extends Error {
    // Error reasons
    static UNKNOWN = 'Unknown';
    static UNAUTHORIZED = 'Unauthorized';
    static NO_VEHICLE = 'Vehicle not found';
    static IN_SERVICE = 'Vehicle in service';
    static UNAVAILABLE = 'Vehicle unavailable';
    static TIMEOUT = 'Timeout';
    static NETWORK = 'Network unavailable';
    static SERVER = 'Internal server error';
    static FORBIDDEN = 'Forbidden';

    constructor(error, reason = null) {
        super((error instanceof Error)? error.message : error);
        this.reason = reason || ApiError.UNKNOWN;
    }
    reason() { return this.reason; }

    static fromStatus(statusCode) {
        switch(statusCode) { // https://developer.tesla.com/docs/fleet-api#response-codes
            case 401: return ApiError.UNAUTHORIZED;
            case 403: return ApiError.FORBIDDEN;
            case 404: return ApiError.NO_VEHICLE;
            case 405: return ApiError.IN_SERVICE;
            case 406: return ApiError.NETWORK; // Not Acceptable
            case 408: return ApiError.UNAVAILABLE;
            case 500: return ApiError.SERVER;
            case 502: return ApiError.NETWORK; // Bad gateway
            case 503: return ApiError.NETWORK; // Service unavailable
            case 504: return ApiError.TIMEOUT;
            case 540: return ApiError.UNAVAILABLE; // TODO: check. Should be system booting
            default:  return ApiError.UNKNOWN;
        }
    }
}

function getHostFromToken(accesToken) {
    const parts = accesToken.split('.');
    if (parts.length != 3) throw new Error("Invalid OAuth access token");
    const info = JSON.parse(Buffer.from(parts[1], "base64"));
    let host = 'fleet-api.prd.na.vn.cloud.tesla.com';
    for(let url of info.aud) {
        if (url.startsWith('https://auth.tesla.')) continue;
        if (url.startsWith('https://')) url = url.slice(8);
        if (url.endsWith('/')) url = url.slice(0, -1);
        if (!/^[A-Za-z0-9-.]+$/.test(url) || !url.startsWith('fleet-api.')) continue;
        if (!url.endsWith('.tesla.com') && !url.endsWith('.tesla.cn') && !url.endsWith('.teslamotors.com')) continue;
        host = url;
        if (host.includes(`.${info.ou_code.toLowerCase()}.`)) return host;
    }
    return host;
}

class FleetApi {
    constructor(client_id, access_token = null, refresh_token = null) {
        this.client_id = client_id;
        this.access_token = access_token;
        this.refresh_token = refresh_token;
        this.timeout = 10000;
        this.baseApi = 'https://'+getHostFromToken(access_token)+'/api/1';
    }

    setTimeout(seconds) {
        this.timeout = seconds * 1000;
    }

    async #oauthCall(params) {
        try {
            const resp = await axios.post('https://auth.tesla.com/oauth2/v3/token', params, { 
                headers: {
                    'User-Agent': 'TeslaEma',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': '*/*'
                },
                timeout: this.timeout
            });
            return resp.data;
        } catch (e) {
            if (e instanceof axios.AxiosError && e.hasOwnProperty('response')) {
                const status = e.response.status;
                throw new ApiError(`${e.response.statusText} (${status})`, ApiError.fromStatus(status));
            }            
            throw new ApiError(e.message + " ("+e.code+")", ApiError.NETWORK);
        }
    }

    onTokenRefresh(callback) {
        this.cb_refreshToken = callback;
    }

    async refreshToken(refresh_token, retry = 1) {
        try {
            const oauth = await this.#oauthCall({
                grant_type: 'refresh_token',
                client_id: this.client_id,
                refresh_token
            });
            this.refresh_token = oauth.refresh_token;
            this.access_token = oauth.access_token;
            if (typeof this.cb_refreshToken == 'function') {
                this.cb_refreshToken(this.access_token, this.refresh_token);
            }
            return oauth;   
        }
        catch(error) {
            if (retry < 3) {
                await new Promise(resolve => setTimeout(resolve, 500));
                return this.refreshToken(refresh_token, retry + 1);
            }
            if (error instanceof Error) error.message += " - Unable to refresh Token";
            throw error;            
        }
    }

    async #apiCall(path, method = 'GET', params = undefined) {
        const axiosData = {
            method: method.toLowerCase(),
            url: this.baseApi + path,
            headers: { 
                'User-Agent': 'TeslaEma', 
                'Authorization': "Bearer " + this.access_token,
                'Accept': '*/*'
            },
            timeout: this.timeout,
            data: (typeof params !== 'undefined')? params : {}
        };
        try {
            const resp = await axios.request(axiosData);
            return resp.data;
        } catch (e) {
            if (e instanceof axios.AxiosError && e.hasOwnProperty('response')) {
                const status = e.response.status;
                if (status == 401 && this.refresh_token != null) {
                    await this.refreshToken(this.refresh_token);
                    return this.#apiCall(path, method, params);
                }
                const error = (e.response.hasOwnProperty('data') && e.response.data.hasOwnProperty('error'))?
                    e.response.data.error : e.response.statusText;
                throw new ApiError(`${error} (${status})`, ApiError.fromStatus(status));
            }
            throw new ApiError(`${e.message} (${e.code})`, ApiError.NETWORK);
        }
    }

    async getVehicles() {
        return this.#apiCall('/vehicles');
    }

    async getVehicle(vehicle_tag) {
        return this.#apiCall('/vehicles/'+vehicle_tag);
    }

    /**
     * https://developer.tesla.com/docs/fleet-api#vehicle_data
     * Starting from firmware update 2023.38+, if you don't specify any endopint, the following ones are returned:
     * charge_state, climate_state, drive_state (without location), gui_settings, vehicle_config, vehicle_state
     * You can ask for the following specific endpoints:
     * charge_state, climate_state, closures_state, drive_state, gui_settings, location_data, vehicle_config, vehicle_state,
     * vehicle_data_combo
     */
    async getVehicleData(vehicle_tag, endpoints = []) {
        let path = `/vehicles/${vehicle_tag}/vehicle_data`;
        if (endpoints.length > 0) path += "?endpoints="+endpoints.join('%3B');
        return this.#apiCall(path);
    }

    async signedCommand(vin, byteBuffer) {
        const resp = await this.#apiCall(`/vehicles/${vin}/signed_command`, 'POST', {
            routable_message: byteBuffer.toString('base64')
        });
        if (!resp.hasOwnProperty('response')) throw new ApiError("Invalid response");
        return Buffer.from(resp.response, 'base64');
    }
}

export { ApiError, FleetApi }