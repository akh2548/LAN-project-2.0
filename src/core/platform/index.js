const WindowsAdapter = require('./windows');
const LinuxAdapter = require('./linux');
const DarwinAdapter = require('./darwin');

function createPlatformAdapter(customPlatform = null) {
  const currentPlatform = customPlatform || process.platform;

  switch (currentPlatform) {
    case 'win32':
      return new WindowsAdapter();
    case 'linux':
      return new LinuxAdapter();
    case 'darwin':
      return new DarwinAdapter();
    default:
      // Fallback to Linux adapter for other POSIX-like platforms
      return new LinuxAdapter();
  }
}

module.exports = {
  createPlatformAdapter,
  WindowsAdapter,
  LinuxAdapter,
  DarwinAdapter
};

