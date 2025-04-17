/**
 * popup.js - Chrome扩展的弹出窗口脚本
 * 这个文件负责处理扩展弹出窗口的交互逻辑和设置保存
 */

// 当弹出窗口的 HTML 文档加载完成时，执行初始化逻辑
document.addEventListener('DOMContentLoaded', () => {
  // 获取所有需要操作的 HTML 元素
  const radioScihub = document.getElementById('modeScihub'); // "跳转到 Sci-Hub" 单选按钮
  const radioOriginal = document.getElementById('modeOriginal'); // "打开原链接" 单选按钮
  const radioDirectDownload = document.getElementById('modeDirectDownload'); // "直接下载" 单选按钮
  const domainSelect = document.getElementById('scihubDomain'); // Sci-Hub 预设域名下拉菜单
  const customInput = document.getElementById('customDomain'); // 自定义 Sci-Hub 域名输入框

  // 从 Chrome 同步存储中读取之前保存的用户设置，并用这些设置初始化界面显示
  chrome.storage.sync.get([
    'openMode',      // 读取保存的操作模式
    'currentDomain' // 读取保存的 Sci-Hub 域名
  ], (res) => {
    // 如果存储中没有值，则使用默认值
    const openMode = res.openMode || 'scihub'; // 默认操作模式为 'scihub'
    const domain = res.currentDomain || 'https://sci-hub.se'; // 默认域名

    // 根据读取到的 openMode，设置对应的单选按钮为选中状态
    if (openMode === 'scihub') {
      radioScihub.checked = true;
    } else if (openMode === 'original') {
      radioOriginal.checked = true;
    } else if (openMode === 'directDownload') {
      radioDirectDownload.checked = true;
    }

    // 根据读取到的域名，设置域名选择区域的状态
    const options = Array.from(domainSelect.options); // 获取下拉菜单的所有选项
    const match = options.find(o => o.value === domain); // 查找是否有与保存的域名匹配的预设选项
    if (match) {
      // 如果在预设选项中找到了匹配项
      match.selected = true; // 选中这个预设选项
      customInput.value = ''; // 清空自定义输入框
    } else {
      // 如果保存的域名不在预设中，则认为是自定义域名
      customInput.value = domain; // 将域名填入自定义输入框
      domainSelect.selectedIndex = -1; // 取消下拉菜单的选中状态
    }
  });

  // 为"操作模式"的三个单选按钮添加事件监听器
  [radioScihub, radioOriginal, radioDirectDownload].forEach(radio => {
    radio.addEventListener('change', () => {
      // 当某个单选按钮状态变为选中时触发
      if (radio.checked) {
        const mode = radio.value; // 获取被选中的单选按钮的 value ('scihub', 'original', 'directDownload')
        // 将新的操作模式保存到 Chrome 存储中
        chrome.storage.sync.set({ openMode: mode });
        console.log('操作模式已保存:', mode);
      }
    });
  });

  // 为预设域名下拉菜单添加事件监听器
  domainSelect.addEventListener('change', () => {
    const newVal = domainSelect.value; // 获取新选中的域名值
    // 保存新的域名到 Chrome 存储
    chrome.storage.sync.set({ currentDomain: newVal });
    customInput.value = ''; // 清空自定义输入框，因为选择了预设值
    console.log('预设域名已保存:', newVal);
  });

  // 为自定义域名输入框添加事件监听器 (每次输入时触发)
  customInput.addEventListener('input', () => {
    const val = customInput.value.trim(); // 获取输入的值并去除首尾空格
    // 简单验证输入是否是看起来像 URL 的格式
    if (val && (val.startsWith('http://') || val.startsWith('https://'))) {
      // 如果是有效格式，保存到 Chrome 存储
      chrome.storage.sync.set({ currentDomain: val });
      domainSelect.selectedIndex = -1; // 取消预设下拉菜单的选中状态
      console.log('自定义域名已保存:', val);
    } else {
      // (可选) 可以在这里添加输入格式错误的提示
    }
  });

}); // DOMContentLoaded 事件监听器结束
