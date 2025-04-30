import { TurboFactory } from '@ardrive/turbo-sdk/web';
import {
  ArconnectSigner,
  bundleAndSignData,
  createData,
} from '@dha-team/arbundles';
import { ConnectButton, useActiveAddress, useApi } from 'arweave-wallet-kit';
import hkdf from 'futoin-hkdf';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { parse } from 'uuid';

// const driveId = '4dc4654e-0c6c-4d45-bb4e-7536abc348a6';
// const rootFolderId = 'aa1f7f45-c56e-4181-8fe3-2323478f0801';

// user drive and root folder
// const driveId = '23f8d50a-afa6-4c3d-8083-86973b7b4737';
// const rootFolderId = '624fb111-cb20-4a71-876c-fa4af64d72c0';

async function getArFSFolder({
  driveId,
  owner,
}: {
  driveId: string;
  owner: string;
}) {
  const queryObj = {
    query: `{
     transactions(
      owners: ["${owner}"]
      tags: [
        { name:"Drive-Id", values:["${driveId}"]},
        { name: "Entity-Type", values:["folder"]}
      ]
      first: 1
    ) {

      edges {
        cursor
        node {
          id
          block {height}
          bundledIn {id}
          owner{address}
          recipient
            tags {
            name
            value
          }
        }
      }
    }}
    `,
  };
  const res = await fetch(`https://arweave.net/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(queryObj),
  });
  const data = await res.json();

  const folderNode = data.data.transactions.edges[0]?.node;
  const folderId = folderNode?.id;
  const folderCipher = folderNode?.tags.find(
    (tag: any) => tag.name === 'Cipher',
  )?.value;
  const folderCipherIV = folderNode?.tags.find(
    (tag: any) => tag.name === 'Cipher-IV',
  )?.value;
  return {
    id: folderId,
    cipher: folderCipher,
    cipherIV: folderCipherIV,
  };
}

function Home() {
  const api = useApi();
  const address = useActiveAddress();
  const [searchParams] = useSearchParams();
  const driveId = searchParams.get('driveId');
  const rootFolderId = searchParams.get('rootFolderId');
  const [driveName, setDriveName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [driveTxResult, setDriveTxResult] = useState<string | null>(null);
  const [rootFolderTxResult, setRootFolderTxResult] = useState<string | null>(
    null,
  );
  function createSigningKey({ driveId }: { driveId: string }) {
    const textEncoder = new TextEncoder();
    const driveBuffer = textEncoder.encode('drive');
    const driveIdBuffer = Buffer.from(parse(driveId));
    return new Uint8Array([...driveBuffer, ...driveIdBuffer]);
  }

  async function fileEncrypt(
    driveOrFolderKey: Buffer,
    folderData: Record<string, any>,
  ) {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      driveOrFolderKey,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt'],
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedBuffer = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        length: 256,
        iv,
      },
      cryptoKey,
      Buffer.from(JSON.stringify(folderData)),
    );

    const encryptedFile = {
      cipher: 'AES256-GCM',
      cipherIV: Buffer.from(iv).toString('base64'),
      data: encryptedBuffer,
    };
    return encryptedFile;
  }

  async function fileDecrypt({
    decryptionKey,
    data,
    // cipher,
    cipherIV,
  }: {
    decryptionKey: Buffer;
    data: Buffer;
    cipher: string;
    cipherIV: string;
  }) {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      decryptionKey,
      { name: 'AES-GCM', length: 256 },
      true,
      ['decrypt'],
    );
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        length: 256,
        iv: Buffer.from(cipherIV, 'base64'),
      },
      cryptoKey,
      data,
    );
    const decryptedFile = JSON.parse(Buffer.from(decryptedBuffer).toString());
    return decryptedFile;
  }

  async function handleDriveEntityCreation({
    driveId,
    rootFolderId,
    driveName,
    password,
  }: {
    driveId: string;
    driveName: string;
    password: string;
    rootFolderId: string;
  }) {
    try {
      if (!api) {
        throw new Error('API not found');
      }
      if (!address) {
        throw new Error('Address not found');
      }
      const turbo = TurboFactory.unauthenticated();
      const signer = new ArconnectSigner(window.arweaveWallet);
      const encoder = new TextEncoder();
      const signingKey = createSigningKey({ driveId });
      const walletSignature = await api.signature(signingKey, {
        name: 'RSA-PSS',
        hash: 'SHA-256',
        saltLength: 0,
      });
      const info = encoder.encode(password);
      const driveKey = hkdf(Buffer.from(walletSignature), 32, {
        info: Buffer.from(info),
        hash: 'SHA-256',
      });

      // verify password by decrypting the an existing folder
      const arfsFolderInfo = await getArFSFolder({ driveId, owner: address });
      console.log(arfsFolderInfo);
      if (!arfsFolderInfo.id) {
        alert('No drive info found, cannot repair drive.');
        return;
      }
      const dataToDecrypt = await fetch(
        `https://arweave.net/${arfsFolderInfo.id}`,
        { method: 'GET' },
      ).then((res) => res.arrayBuffer());

      await fileDecrypt({
        decryptionKey: driveKey,
        cipher: arfsFolderInfo.cipher,
        cipherIV: arfsFolderInfo.cipherIV,
        data: Buffer.from(dataToDecrypt),
      }).catch((e) => {
        setPasswordError('Incorrect password');
        throw new Error(e);
      });

      // root folder data item
      const {
        cipher: folderCipher,
        cipherIV: folderCipherIV,
        data: folderData,
      } = await fileEncrypt(driveKey, {
        name: driveName,
        isHidden: false,
      });
      console.log('folderData', folderData);
      await signer.setPublicKey();
      const rootFolderDataItem = createData(
        new Uint8Array(folderData),
        signer,
        {
          tags: [
            { name: 'Content-Type', value: 'application/octet-stream' },
            { name: 'Entity-Type', value: 'folder' },
            { name: 'Drive-Id', value: driveId },
            { name: 'Folder-Id', value: rootFolderId },

            { name: 'ArFS', value: '0.14' },

            { name: 'Cipher', value: folderCipher },
            { name: 'Cipher-IV', value: folderCipherIV }, // set when encrypting
            {
              name: 'Unix-Time',
              value: Math.floor(Date.now() / 1000).toString(),
            },

            { name: 'App-Name', value: 'ArDrive-App' },
            { name: 'App-Platform', value: 'Web' },
            { name: 'App-Version', value: '2.67.2' },

            // future debugging
            { name: 'App-Name', value: 'Ardrive-Repair-Kit' },
          ],
        },
      );

      // drive data item
      const {
        cipher: driveCipher,
        cipherIV: driveCipherIV,
        data: driveData,
      } = await fileEncrypt(driveKey, {
        name: driveName,
        rootFolderId,
        isHidden: false,
      });
      const driveDataItem = createData(new Uint8Array(driveData), signer, {
        tags: [
          { name: 'Content-Type', value: 'application/octet-stream' },
          { name: 'Entity-Type', value: 'drive' },
          { name: 'Drive-Id', value: driveId },
          { name: 'Drive-Privacy', value: 'private' },
          { name: 'Drive-Auth-Mode', value: 'password' },

          { name: 'ArFS', value: '0.14' },

          { name: 'Cipher', value: driveCipher },
          { name: 'Cipher-IV', value: driveCipherIV }, // set when encrypting
          {
            name: 'Unix-Time',
            value: Math.floor(Date.now() / 1000).toString(),
          },

          { name: 'App-Name', value: 'ArDrive-App' },
          { name: 'App-Platform', value: 'Web' },
          { name: 'App-Version', value: '2.67.2' },

          // future debugging
          { name: 'App-Name', value: 'Ardrive-Repair-Kit' },
        ],
      });

      const bundle = await bundleAndSignData(
        [rootFolderDataItem, driveDataItem],
        signer,
      );

      const bdi = createData(new Uint8Array(bundle.getRaw()), signer, {
        tags: [
          {
            name: 'Bundle-Format',
            value: 'binary',
          },
          {
            name: 'Bundle-Version',
            value: '2.0.0',
          },
          {
            name: 'Content-Type',
            value: 'application/octet-stream',
          },
        ],
      });
      await bdi.sign(signer);

      await turbo.uploadSignedDataItem({
        dataItemSizeFactory: () => bdi.getRaw().length,
        dataItemStreamFactory: () => bdi.getRaw(),
      });

      setDriveTxResult(driveDataItem.id);
      setRootFolderTxResult(rootFolderDataItem.id);
    } catch (error: any) {
      console.error(error);
      alert(
        `Error repairing drive: \n${JSON.stringify(error)}\n\nPlease try again.`,
      );
    }
  }

  return (
    <div className="flex size-full flex-col  items-center bg-background">
      <div className="mb-2 flex w-full justify-between bg-tertiary p-2">
        {' '}
        <h1 className="p-5 text-2xl text-white">
          Ardrive Restore Drive Utility
        </h1>
        <ConnectButton />
      </div>

      <div className="flex w-1/2 flex-col gap-4">
        <div className="flex flex-col gap-2 border-b border-secondary pb-4">
          <span className="text-xl text-white underline">What is this?</span>
          <span className="text-white">
            This tool restores PRIVATE Drives for which the Drive and/or Root
            Folder transactions did not make it on chain before adding files
            and/or folders to them. It will:
          </span>
          <ul className="list-disc space-y-2 pl-10 text-white">
            <li>
              <span className="text-white">
                Ensure that your provided password correctly generates the drive
                key necessary to unlock existing drive contents
              </span>
            </li>
            <li>
              <span className="text-white">
                Use whatever drive name you provide here (it can be different
                than what you originally provided)
              </span>
            </li>
            <li>
              <span className="text-white">
                Create the new Drive and Root Folder atomically via ArDrive
                Turbo
              </span>
            </li>
          </ul>
          <span className="border-b border-secondary pb-4 text-white">
            Once successfully completed, your drive will be available in ArDrive
            after a deep sync or a new login after a few minutes.
          </span>
          <div className="flex flex-col gap-2">
            <span className="text-xl text-white underline">
              Steps to restore a drive:
            </span>
            <ol className="list-decimal space-y-2 pl-10 text-white">
              <li>
                <span className="text-white">
                  Connect your wallet - it should be the same wallet you used to
                  create the drive
                </span>
              </li>
              <li>
                <span className="text-white">
                  Enter a drive name and password. Password should be the same,
                  you can use any drive name.
                </span>
              </li>
              <li>
                <span className="text-white">
                  Click the &quot;Repair Drive&quot; button
                </span>
              </li>
              <li>
                <span className="text-white">
                  Once completed, your drive will be available in ArDrive after
                  a sync or a new login after a few minutes.
                </span>
              </li>
            </ol>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="driveId" className="text-white">
            Drive ID
          </label>
          <span className="text-white">{driveId}</span>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="rootFolderId" className="text-white">
            Root Folder ID
          </label>
          <span className="text-white">{rootFolderId}</span>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="driveName" className="text-white">
            Drive Name
          </label>
          <input
            type="text"
            id="driveName"
            className="rounded-md border-2 border-input bg-foreground p-2 text-white"
            onChange={(e) => setDriveName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-white">
            Password
          </label>
          <input
            type="password"
            id="password"
            className="rounded-md border-2 border-input bg-foreground p-2 text-white"
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordError(null);
            }}
          />
        </div>
        {passwordError && <div className="text-red-500">{passwordError}</div>}
        <button
          disabled={!password?.length || !driveName?.length}
          className="rounded-md bg-primary p-2 text-white disabled:opacity-30"
          onClick={() => {
            if (!driveId || !rootFolderId || !driveName || !password) {
              throw new Error('Missing required fields');
            }
            handleDriveEntityCreation({
              driveId,
              rootFolderId,
              driveName,
              password,
            });
          }}
        >
          Repair Drive
        </button>

        {driveTxResult && (
          <div className="text-white">
            <h2>Drive Tx Result</h2>
            <p>{driveTxResult}</p>
          </div>
        )}

        {rootFolderTxResult && (
          <div className="text-white">
            <h2>Root Folder Tx Result</h2>
            <p>{rootFolderTxResult}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Home;
