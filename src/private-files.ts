import fs from 'node:fs';
import path from 'node:path';

// DATA_DIR is a dedicated application directory, never a shared document folder.
// POSIX mode bits do not replace Windows ACLs or protect against the same OS user.
export function privateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(directory).isDirectory()) throw new Error('Private directory must not be a symlink');
  fs.chmodSync(directory, 0o700);
}

export function privateFile(filename: string): void {
  let info: fs.Stats;
  try { info = fs.lstatSync(filename); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (!info.isFile() || info.nlink !== 1) throw new Error('Private file must be a regular, unlinked file');
  fs.chmodSync(filename, 0o600);
}

export function privateOriginals(directory: string): void {
  privateDirectory(directory);
  for (const entry of fs.readdirSync(directory)) privateFile(path.join(directory, entry));
}

export function copyPrivateFile(source: string, destination: string): void {
  if (!fs.lstatSync(source).isFile()) throw new Error('Source must be a regular file');
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  privateFile(destination);
}

export function copyPrivateOriginals(source: string, destination: string): void {
  if (!fs.lstatSync(source).isDirectory()) throw new Error('Original directory must not be a symlink');
  privateDirectory(destination);
  for (const entry of fs.readdirSync(source)) copyPrivateFile(path.join(source, entry), path.join(destination, entry));
}
