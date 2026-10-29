/**
 * Timer Utility cho dự án Quin-Iu-Mthu-Code-mobile
 * Giúp bro quản lý đếm giây một cách chính xác
 */

export class Timer {
  constructor(callback) {
    this.seconds = 0;
    this.intervalId = null;
    this.callback = callback; // Hàm xử lý mỗi khi nhảy giây
  }

  start() {
    if (!this.intervalId) {
      this.intervalId = setInterval(() => {
        this.seconds++;
        if (this.callback) this.callback(this.seconds);
      }, 1000);
      console.log("Timer đã bắt đầu!");
    }
  }

  stop() {
    clearInterval(this.intervalId);
    this.intervalId = null;
    console.log("Timer đã dừng tại giây thứ: " + this.seconds);
  }

  reset() {
    this.stop();
    this.seconds = 0;
  }
}
