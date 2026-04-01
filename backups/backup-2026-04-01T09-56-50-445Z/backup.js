const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.resolve(__dirname);
const BACKUP_ROOT = path.join(SOURCE_DIR, 'backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(BACKUP_ROOT, `backup-${timestamp}`);

const exclude = new Set(['node_modules', '.git', 'backups']);

const copyRecursive = async (src, dest) => {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (exclude.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
};

(async () => {
  try {
    console.log(`Creating backup at ${destination}`);
    await copyRecursive(SOURCE_DIR, destination);
    console.log('Backup completed successfully.');
  } catch (error) {
    console.error('Backup failed:', error.message || error);
    process.exit(1);
  }
})();
