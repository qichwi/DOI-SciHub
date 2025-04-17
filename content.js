(function() {
  // 使用立即执行函数表达式 (IIFE) 避免污染全局作用域

  // 定义用于匹配 DOI 的正则表达式
  // 10.xxxx/xxxx... (x 是数字，/ 后面可以有各种字符，非空白符结尾)
  const doiRegex = /(10\.\d{4,}(?:\.\d+)*\/[^\s]+)/i;

  // 监听整个文档的点击事件 (使用事件委托)
  document.addEventListener('click', function(e) {
    // e.target 是用户实际点击的元素
    let target = e.target;

    // 从被点击的元素开始，向上遍历 DOM 树，直到找到 <a> 标签或到达文档顶层
    while (target && target !== document) {
      // 检查当前元素是否是 <a> 标签并且有 href 属性
      if (target.tagName === 'A' && target.href) {
        const linkHref = target.href;

        // 检查链接是否是 DOI 链接
        // 条件 1: 链接明确指向 doi.org (包括 dx.doi.org)
        // 条件 2: 链接本身能够匹配 DOI 正则表达式 (有些网站直接链 DOI)
        if (linkHref.match(/https?:\/\/(?:dx\.)?doi\.org\//i) || linkHref.match(doiRegex)) {

          // 阻止链接的默认跳转行为
          e.preventDefault();

          // 向后台脚本发送消息，请求处理这个链接
          chrome.runtime.sendMessage({
            action: 'openPaper', // 指定动作类型为 'openPaper'
            url: linkHref        // 将被点击的链接 URL 发送给后台
          });

          // 找到并处理完链接后，停止向上遍历
          return;
        }
      }
      // 如果当前元素不是目标 <a> 标签，继续向上查找父元素
      target = target.parentNode;
    }
  });

})(); // IIFE 结束
