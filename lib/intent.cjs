// Intent parser cho các lệnh reset
function parseResetCommand(msg) {
  if (msg.includes('207')) return { type: 'RESET_207', target: 'primary' };
  if (msg.includes('206')) return { type: 'RESET_206', target: 'secondary' };
}
