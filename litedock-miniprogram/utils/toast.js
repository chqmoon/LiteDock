/* 弹提示的统一出口：微信 showLoading 与 showToast 共用同一个原生视图，
   hideLoading 之后立即 showToast 在真机上会被吞掉，必须延迟一拍再弹 */
function toast(opts) {
  setTimeout(() => {
    wx.showToast(Object.assign({ icon: 'none', duration: 2500 }, opts || {}));
  }, 80);
}

module.exports = { toast };
