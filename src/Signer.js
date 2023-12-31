import elliptic from 'elliptic';
import crypto from 'crypto';
import protobuf from "protobufjs";

const EPOCH_LENGTH = (1 << 30);

const protoSignatures = await protobuf.load('proto/signatures.proto');
const Tags = protoSignatures.lookupEnum("Signatures.Tag").values;
const SignatureTypes = protoSignatures.lookupEnum("Signatures.SignatureType").values;

class Metadata {
    constructor(context) {
        this.context = context;
        this.fields = {};
        this.last = 0;
    }
  
    add(tag, value) {
        if (tag < this.last) throw new Error("metadata items need to be added in increasing tag order");
        if (value === null) return;
        if (value.length > 255) throw new Error("metadata fields can't be more than 255 bytes long");
        
        this.last = tag;
        this.context.update(Buffer.from([tag]));
        this.context.update(Buffer.from([value.length]));
        this.context.update(value);
        this.fields[tag] = true;
    }
  
    addUint32(tag, value) {
        let buffer = Buffer.alloc(4);
        buffer.writeUInt32BE(value);
        this.add(tag, buffer);
    }
  
    checksum(message) {
        this.context.update(Buffer.from([255])); // signatures.Tag_TAG_END
        this.context.update(message);
        return this.context.digest();
    }
}

class AuthSession {
    constructor(key, serverPublicKey) {
        // Generates the shared secret
        const ec = new elliptic.ec('p256');
        const privateKey = ec.keyFromPrivate(key.privateKey);
        const publicKey = ec.keyFromPublic(serverPublicKey);
        const sharedSecret = privateKey.derive(publicKey.getPublic());

        // SHA1 is used to maintain compatibility with existing vehicle code, and is safe to use in this context 
        // since we're just mapping a pseudo-random curve point into a pseudo-random bit string.  
        // Collision resistance isn't needed.    
        const hash = crypto.createHash('sha1');
        hash.update(Buffer.from(sharedSecret.toString(16), 'hex'));
        this.key = hash.digest().subarray(0, 16);
        // this.gcm = crypto.createCipheriv('aes-128-gcm', this.key, Buffer.alloc(12,0));
        this.localPublic = key.publicKey;
    }

    newHMAC(label) {
        const kdf = crypto.createHmac('sha256', this.key);
        kdf.update(Buffer.from(label, 'utf8'));
        return crypto.createHmac('sha256', kdf.digest());        
    }
}

class Signer {
    constructor(key, verifierName, verifierSessionInfo) {
        this.session = new AuthSession(key, verifierSessionInfo.publicKey);
        this.verifierName = verifierName;
        this.timeZero = Math.floor(Date.now() / 1000) - verifierSessionInfo.clockTime;
        this.epoch = Buffer.from(verifierSessionInfo.epoch, 0, 16);
        this.counter = verifierSessionInfo.counter;
    }

    validateSessionInfo(encodedSessionInfo, challenge, tag) {
        const meta = new Metadata(this.session.newHMAC('session info'));
        meta.add(Tags.TAG_SIGNATURE_TYPE, Buffer.from([SignatureTypes.SIGNATURE_TYPE_HMAC]));
        meta.add(Tags.TAG_PERSONALIZATION, Buffer.from(this.verifierName));
        meta.add(Tags.TAG_CHALLENGE, challenge);
        const validTag = meta.checksum(encodedSessionInfo);
        return crypto.timingSafeEqual(validTag, tag);
    }

    generateSignature(encodedPayload, domain, expiresIn) {
        this.counter++;

        const meta = new Metadata(this.session.newHMAC('authenticated command'));
        meta.add(Tags.TAG_SIGNATURE_TYPE, Buffer.from([SignatureTypes.SIGNATURE_TYPE_HMAC_PERSONALIZED]));
        meta.add(Tags.TAG_DOMAIN, Buffer.from([domain]));
        meta.add(Tags.TAG_PERSONALIZATION, Buffer.from(this.verifierName));
        
        const expiresAt = Math.floor(Date.now() / 1000) + expiresIn - this.timeZero;
        // Bounds check ensures: (1) we can encode in a 4-byte buffer and (2)
        // will not overflow time.Duration.
        if (expiresAt > EPOCH_LENGTH || expiresAt < 0) throw new Error("out of bounds expiration time");

        meta.add(Tags.TAG_EPOCH, this.epoch);
        meta.addUint32(Tags.TAG_EXPIRES_AT, expiresAt);
        meta.addUint32(Tags.TAG_COUNTER, this.counter);
    
        //return signatureDataProto.create({
        return {
            signerIdentity: {
                publicKey: this.session.localPublic
            },
            HMAC_PersonalizedData: {
                epoch:     this.epoch,
                counter:   this.counter,
                expiresAt: expiresAt,
                tag:       meta.checksum(encodedPayload)
            }
        };
    }
}

export { Signer };