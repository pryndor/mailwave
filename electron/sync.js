// FTP / SFTP sync — pulls subscriber CSV from cPanel server
const ftp      = require('basic-ftp');
const Papa     = require('papaparse');
const settings = require('./settings');
const license  = require('./license');

async function syncFtp({ host, port, user, password, remote_path, protocol, tls }) {
  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    await client.access({
      host,
      port:     Number(port) || 21,
      user,
      password,
      secure:   protocol === 'ftps' || tls,
    });

    // Download CSV into memory
    const chunks = [];
    const writable = new (require('stream').Writable)({
      write(chunk, _, cb) { chunks.push(chunk); cb(); }
    });
    await client.downloadTo(writable, remote_path);
    const csv = Buffer.concat(chunks).toString('utf8');
    return { ok: true, csv };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    client.close();
  }
}

async function syncSftp({ host, port, user, password, remote_path }) {
  const SftpClient = require('ssh2-sftp-client');
  const sftp = new SftpClient();
  try {
    await sftp.connect({ host, port: Number(port) || 22, username: user, password });
    const buffer = await sftp.get(remote_path);
    await sftp.end();
    const csv = buffer.toString('utf8');
    return { ok: true, csv };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function syncFromServer(syncCfg) {
  if (!license.isPro(settings.getAll().license_key)) {
    return { ok: false, error: 'FTP/SFTP sync is a Pro feature.', proRequired: true };
  }

  const result = syncCfg.protocol === 'sftp'
    ? await syncSftp(syncCfg)
    : await syncFtp(syncCfg);

  if (!result.ok) return result;

  // Parse CSV
  const parsed = Papa.parse(result.csv, { header: true, skipEmptyLines: true });
  return { ok: true, rows: parsed.data, fields: parsed.meta.fields };
}

module.exports = { syncFromServer };
