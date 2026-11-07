// Xử lý lệnh reset từ Cloud
async function handleResetCommand(cmd) {
  switch(cmd.type) {
    case 'RESET_207':
      // Reset thiết bị chính
      await executeReset('primary');
      break;
    case 'RESET_206':
      // Reset thiết bị phụ
      await executeReset('secondary');
      break;
  }
}
