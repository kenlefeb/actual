import crypto from 'node:crypto';

import {
  create,
  MessageEnvelopeSchema,
  MessageSchema,
  SyncRequestSchema,
  toBinary,
} from '@actual-app/crdt';
import request from 'supertest';

import { getAccountDb } from './account-db';
import { handlers as app } from './app-sync';

const OTHER_USER_ID = 'otherUser';

function addFile(owner: string, salt = 'salt', test = 'test') {
  const fileId = crypto.randomBytes(16).toString('hex');
  getAccountDb().mutate(
    'INSERT INTO files (id, group_id, sync_version, encrypt_meta, encrypt_salt, encrypt_keyid, encrypt_test, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      fileId,
      'group-id',
      2,
      JSON.stringify({ keyId: 'key-id' }),
      salt,
      'key-id',
      test,
      owner,
    ],
  );
  return fileId;
}

describe('sync-server access log', () => {
  let written: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    written = [];
    spy = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
      written.push(String(chunk));
      return true;
    });
  });
  afterEach(() => spy.mockRestore());

  const accessLines = () =>
    written
      .flatMap(chunk => chunk.split('\n'))
      .filter(line => line.includes('"event":"file-access"'))
      .map(line => JSON.parse(line) as Record<string, unknown>);

  it('records user, file, route, method, status and time when access is allowed', async () => {
    const fileId = addFile('genericAdmin');

    await request(app)
      .post('/user-get-key')
      .set('x-actual-token', 'valid-token')
      .send({ fileId })
      .expect(200);

    const lines = accessLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      userId: 'genericAdmin',
      fileId,
      method: 'POST',
      route: '/user-get-key',
      status: 200,
    });
    expect(new Date(String(lines[0].time)).toISOString()).toBe(lines[0].time);
  });

  it('records a denied request with its 403 status', async () => {
    const fileId = addFile(OTHER_USER_ID);

    await request(app)
      .post('/user-get-key')
      .set('x-actual-token', 'valid-token-user')
      .send({ fileId })
      .expect(403);

    expect(accessLines()).toEqual([
      expect.objectContaining({ userId: 'genericUser', fileId, status: 403 }),
    ]);
  });

  it('The access log holds no content: a sync request logs nothing from the budget or the token', async () => {
    const fileId = addFile(
      'genericAdmin',
      'SECRET-SALT-VALUE',
      'SECRET-ENCRYPT-TEST',
    );
    const timestamp = '2020-01-01T00:00:00.000Z-0000-0000000000000000';
    const syncRequest = create(SyncRequestSchema, {
      fileId,
      groupId: 'group-id',
      keyId: 'key-id',
      since: timestamp,
      messages: [
        create(MessageEnvelopeSchema, {
          timestamp,
          isEncrypted: false,
          content: toBinary(
            MessageSchema,
            create(MessageSchema, {
              dataset: 'SECRET-DATASET',
              row: 'SECRET-ROW',
              column: 'SECRET-COLUMN',
              value: 'S:SECRET-PAYEE-AMOUNT',
            }),
          ),
        }),
      ],
    });

    await request(app)
      .post('/sync')
      .set('x-actual-token', 'valid-token')
      .set('Content-Type', 'application/actual-sync')
      .send(Buffer.from(toBinary(SyncRequestSchema, syncRequest)))
      .expect(200);

    const [line] = accessLines();
    expect(Object.keys(line).sort()).toEqual([
      'event',
      'fileId',
      'method',
      'route',
      'status',
      'time',
      'userId',
    ]);
    expect(line).toMatchObject({
      userId: 'genericAdmin',
      fileId,
      route: '/sync',
    });
    const everything = written.join('');
    for (const secret of [
      'valid-token',
      'SECRET-SALT-VALUE',
      'SECRET-ENCRYPT-TEST',
      'SECRET-DATASET',
      'SECRET-ROW',
      'SECRET-COLUMN',
      'SECRET-PAYEE-AMOUNT',
    ]) {
      expect(everything).not.toContain(secret);
    }
  });

  it('writes no access line for a request that touches no budget', async () => {
    await request(app)
      .get('/list-user-files')
      .set('x-actual-token', 'valid-token')
      .expect(200);

    expect(accessLines()).toEqual([]);
  });
});
