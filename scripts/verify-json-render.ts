import { experimental_composeSpec } from '@json-render/core';

const expectedCommit = '3ad381881194e7011ad3ccd6d668033495a06c29';
const expectedSha = '0b002467614c0ade41e18ef6b15c116e9cf41fbe44cd49c6d93a49fe5adf73e6';
const archivePath = new URL('../vendor/json-render-core-3ad38188.tgz', import.meta.url);
const metadataPath = new URL('../vendor/json-render-core-3ad38188.json', import.meta.url);

const bytes = await Bun.file(archivePath).arrayBuffer();
const actualSha = new Bun.CryptoHasher('sha256').update(new Uint8Array(bytes)).digest('hex');
const metadata = await Bun.file(metadataPath).json() as { upstreamCommit?: string; sha256?: string };
if (actualSha !== expectedSha) throw new Error('Pinned json-render core archive checksum mismatch');
if (metadata.upstreamCommit !== expectedCommit || metadata.sha256 !== expectedSha) throw new Error('Pinned json-render provenance mismatch');
if (typeof experimental_composeSpec !== 'function') {
  throw new Error('Installed @json-render/core does not contain the official experimental composer API');
}
console.log(`json-render Jev preview verified: ${expectedCommit.slice(0, 12)} / ${expectedSha.slice(0, 12)}`);
