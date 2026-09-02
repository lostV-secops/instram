import fs from 'fs';
import path from 'path';

// =====================================================================
// StorageClient — abstraction S3 / local filesystem
//
// Architecture §2 : exports CSV/PDF/XLSX stockés sur S3 en prod.
// STORAGE_PROVIDER=local → LocalStorageClient (./exports/)
// STORAGE_PROVIDER=s3    → S3StorageClient (AWS SDK v3)
//
// Hypothèse : en développement, les URLs signées sont de simples URLs HTTP
// locales (http://localhost:4000/exports/{key}), valables indéfiniment.
// En production, elles sont signées avec expiration de 24 h.
// =====================================================================

export interface StorageClient {
  /**
   * Upload un buffer vers le stockage.
   * Retourne l'URL de base (non-signée) — pour usage interne uniquement.
   */
  upload(key: string, buffer: Buffer, contentType: string): Promise<{ url: string }>;

  /**
   * Génère une URL signée/temporaire valable `expiresIn` secondes.
   */
  getSignedUrl(key: string, expiresIn: number): Promise<string>;
}

// =====================================================================
// LocalStorageClient — développement uniquement
// Écrit dans ./exports/{key} relativement au CWD du process.
// =====================================================================

export class LocalStorageClient implements StorageClient {
  private readonly baseDir: string;
  private readonly baseUrl: string;

  constructor(
    baseDir = path.resolve(process.cwd(), 'exports'),
    baseUrl = `http://localhost:${process.env.PORT ?? 4000}/exports`,
  ) {
    this.baseDir = baseDir;
    this.baseUrl = baseUrl;
  }

  async upload(key: string, buffer: Buffer, _contentType: string): Promise<{ url: string }> {
    const filePath = path.join(this.baseDir, key);
    const dir = path.dirname(filePath);

    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath, buffer);

    return { url: `${this.baseUrl}/${key}` };
  }

  async getSignedUrl(key: string, _expiresIn: number): Promise<string> {
    // En local, l'URL "signée" est simplement l'URL publique (aucune expiration).
    return `${this.baseUrl}/${key}`;
  }
}

// =====================================================================
// S3StorageClient — production (AWS SDK v3)
// Lit : AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME
// Ne jamais mettre les vraies clés ici — utiliser les variables d'environnement.
// =====================================================================

export class S3StorageClient implements StorageClient {
  private readonly bucket: string;
  private readonly region: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET_NAME ?? 'instram-exports';
    this.region = process.env.AWS_REGION ?? 'eu-west-3';
  }

  async upload(key: string, buffer: Buffer, contentType: string): Promise<{ url: string }> {
    // Import dynamique pour éviter l'erreur si le SDK n'est pas installé en dev.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3') as typeof import('@aws-sdk/client-s3');

    const client = new S3Client({ region: this.region });

    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    return { url: `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}` };
  }

  async getSignedUrl(key: string, expiresIn: number): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3') as typeof import('@aws-sdk/client-s3');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner') as typeof import('@aws-sdk/s3-request-presigner');

    const client = new S3Client({ region: this.region });
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });

    return getSignedUrl(client, command, { expiresIn });
  }
}

// =====================================================================
// Factory
// =====================================================================

let _storageClient: StorageClient | undefined;

export function createStorageClient(): StorageClient {
  if (_storageClient) return _storageClient;

  const provider = process.env.STORAGE_PROVIDER ?? 'local';

  if (provider === 's3') {
    _storageClient = new S3StorageClient();
  } else {
    _storageClient = new LocalStorageClient();
  }

  return _storageClient;
}

/** Injecter un client de test (pour mocks unitaires). */
export function _setStorageClientForTest(client: StorageClient): void {
  _storageClient = client;
}
