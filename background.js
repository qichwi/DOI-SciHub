// background.js
// 这是Chrome扩展的后台脚本 (Service Worker)
// 它在后台运行，处理来自内容脚本、弹出窗口的消息，并监听浏览器事件（如下载）

// ========= 全局变量和常量 =========

// 用于从 URL 或文本中提取 DOI 的正则表达式
const doiRegex = /(10\.\d{4,}(?:\.\d+)*\/[^\s]+)/i;

// Offscreen 文档的 HTML 文件路径
const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html';

// 用于存储"直接下载"模式下，通过注入脚本预先提取到的重命名信息
// 键是 PDF 的直接下载 URL，值是 { year, title, journal } 对象
let pendingRenames = {};

// ========= 消息监听器 =========

// 监听来自其他部分的扩展消息 (例如 popup.js, content.js, 或注入的脚本)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // --- 处理来自 content.js 的请求：打开论文 --- 
  if (request.action === 'openPaper') {
    console.log("收到 openPaper 请求, URL:", request.url);
    handleOpenPaper(request.url); // 调用处理函数
    return true; // 表明我们将异步处理此消息 (handleOpenPaper 包含异步操作)
  }
  // --- 处理来自注入脚本 (triggerDownloadInTab) 的请求：下载并重命名 --- 
  else if (request.action === 'downloadAndRenameRequest') {
    console.log("收到 downloadAndRenameRequest:", request);
    // 确认消息包含必要的 URL 和文献信息
    if (request.url && request.info) {
      // 将待重命名的信息存入 pendingRenames 缓存
      pendingRenames[request.url] = request.info;
      console.log(`存储待重命名信息 for ${request.url}:`, request.info);
      
      // 使用 chrome.downloads API 启动下载
      chrome.downloads.download({ url: request.url })
        .then(downloadId => {
            // 下载成功开始 (注意：此时文件不一定下载完成)
            console.log(`下载已启动 (ID: ${downloadId}) for ${request.url}`);
            // 设置一个超时定时器，防止某些情况下 onDeterminingFilename 未被触发，导致内存泄漏
            setTimeout(() => {
                if (pendingRenames[request.url]) {
                    console.warn(`清除超时的待重命名信息 for ${request.url}`);
                    delete pendingRenames[request.url];
                }
            }, 30 * 1000); // 30 秒后清除
        })
        .catch(err => {
            // 下载启动失败
            console.error(`启动下载失败 for ${request.url}:`, err);
            delete pendingRenames[request.url]; // 清除对应的缓存信息
        });
    } else {
        console.error("downloadAndRenameRequest 缺少 url 或 info");
    }
    // 这个消息处理是同步的，不需要返回 true
    return false;
  }
  // --- 处理发往 Offscreen 文档的消息 --- 
  else if (request.target === 'offscreen' && request.action === 'parseHtml') {
    // 这是由 background.js 发起，目标是 offscreen.js 的消息
    // background.js 的这个监听器不应该处理它，让消息正常传递到 Offscreen 文档
    // console.log("消息发往 offscreen，后台忽略");
    // **重要**: 这里必须返回 false 或 undefined，否则会中断消息传递！
    return false; 
  }

  // 对于其他未识别的消息，可以选择返回 false (或不返回)
  // console.log("收到未处理的消息:", request);
  // return false; 
});

// ========= 主要功能函数 =========

/**
 * 处理打开论文的请求，根据用户设置的模式执行不同操作
 * @param {string} originalUrl - 用户点击的原始链接 (通常是 DOI 链接)
 */
function handleOpenPaper(originalUrl) {
  // 显示错误通知的辅助函数
  const showError = (msg) => {
    chrome.notifications.create({
      type: 'basic', iconUrl: 'icons/ravenround.png', title: 'DOI-SCI插件错误', message: msg
    });
  };

  try {
    console.log('开始处理文献链接:', originalUrl);
    // 从存储中读取当前用户设置 (移除 'autoDownload')
    chrome.storage.sync.get(['openMode', 'currentDomain'], (res) => {
      try {
        // 获取设置值，若不存在则使用默认值
        const resolvedOpenMode = res.openMode || 'scihub';
        const resolvedCurrentDomain = res.currentDomain || 'https://sci-hub.se';
        console.log('当前设置 - 模式:', resolvedOpenMode, '域名:', resolvedCurrentDomain);

        // --- 根据操作模式执行不同逻辑 ---
        if (resolvedOpenMode === 'scihub') {
          // --- 模式 1: 跳转到 Sci-Hub ---
          const doi = extractDoiFromUrl(originalUrl);
          console.log('提取到的DOI:', doi);
          if (doi) {
            // 构建 Sci-Hub 链接
            const scihubUrl = `${resolvedCurrentDomain}/${doi}`;
            console.log('生成Sci-Hub链接:', scihubUrl);
            // 创建新标签页打开 Sci-Hub 链接
            chrome.tabs.create({ url: scihubUrl }, (newTab) => {
              // 移除标签页创建后的回调函数中关于 autoDownloadEnabled 的判断和 executeScript 调用
              if (chrome.runtime.lastError) {
                // 处理创建标签页时可能发生的错误
                showError(`打开Sci-Hub标签页失败: ${chrome.runtime.lastError.message}`);
              } 
              // 移除: else if (newTab && autoDownloadEnabled) { ... }
              else if (newTab) {
                 // 可以保留一个简单的日志，表明标签页已创建
                 console.log(`已在标签页 ${newTab.id} 中打开 Sci-Hub 链接: ${scihubUrl}`);
              }
            });
          } else {
            // 如果无法从原始链接提取 DOI
            showError('无法从链接中提取DOI，将打开原始链接。');
            chrome.tabs.create({ url: originalUrl });
          }
        } else if (resolvedOpenMode === 'original') {
          // --- 模式 2: 打开原链接 ---
          console.log('当前为打开原链接模式');
          chrome.tabs.create({ url: originalUrl });

        } else if (resolvedOpenMode === 'directDownload') {
          // --- 模式 3: 直接下载 (后台进行) ---
          console.log('直接下载模式启动...');
          const doi = extractDoiFromUrl(originalUrl);
          if (!doi) {
            showError('直接下载失败：无法从链接中提取DOI。');
            return; // 无法提取 DOI，直接结束
          }
          // 构建 Sci-Hub 链接
          const scihubUrl = `${resolvedCurrentDomain}/${doi}`;
          console.log('准备后台访问Sci-Hub链接:', scihubUrl);

          // 使用异步 IIFE (立即执行的异步函数) 来执行后台下载流程
          (async () => {
            let tempTab = null; // 用于存储临时标签页的引用
            try {
                // 1. 创建一个临时的、非激活状态的标签页来加载 Sci-Hub 页面
                console.log('正在创建临时标签页...');
                tempTab = await chrome.tabs.create({ url: scihubUrl, active: false });
                console.log(`临时标签页已创建 (ID: ${tempTab.id})`);

                // 2. 等待标签页加载
                //    简单的固定延迟可能不够可靠，更优方案是监听 chrome.tabs.onUpdated 事件
                //    但为简化起见，暂时使用固定延迟
                console.log(`等待临时标签页 ${tempTab.id} 加载 (设置 3 秒)...`);
                await new Promise(resolve => setTimeout(resolve, 3000)); 

                // 3. 在临时标签页中注入并执行 triggerDownloadInTab 函数
                 console.log(`在临时标签页 ${tempTab.id} 中执行提取和下载脚本...`);
                 // 注意：executeScript 返回的是一个包含结果的对象数组，但我们主要关心注入函数内部的 console.log 和它发送的消息
                 await chrome.scripting.executeScript({
                    target: { tabId: tempTab.id },
                    function: triggerDownloadInTab
                 });
                 console.log("注入脚本执行完毕。"); 
                 // 此时，如果 triggerDownloadInTab 成功，它应该已经发送了 downloadAndRenameRequest 消息
                 // 后续的下载和重命名将由 onMessage 和 onDeterminingFilename 监听器处理

                 // 4. 延迟关闭临时标签页
                 //    延迟是为了给下载请求足够的时间被浏览器接收和处理
                 setTimeout(() => {
                     if (tempTab && tempTab.id) {
                         console.log(`尝试关闭临时标签页 ${tempTab.id}...`);
                         // 使用 chrome.tabs.remove 关闭标签页
                         chrome.tabs.remove(tempTab.id).catch(err => 
                           // 忽略关闭错误，可能标签页已被用户或其他原因关闭
                           console.warn(`关闭临时标签页 ${tempTab.id} 时发生错误 (可能已被关闭): ${err.message}`)
                         );
                     }
                 }, 1000); // 延迟 2 秒后关闭

            } catch (err) {
                // 处理在直接下载流程中可能发生的错误 (如创建标签页失败、执行脚本失败)
                showError(`直接下载处理过程中发生错误: ${err.message}`);
                console.error('直接下载流程出错:', err);
                // 如果发生错误，也尝试关闭可能已经创建的临时标签页
                if (tempTab && tempTab.id) {
                   chrome.tabs.remove(tempTab.id).catch(err => 
                     console.warn(`关闭出错的临时标签页 ${tempTab.id} 时发生错误: ${err.message}`)
                   );
                }
            }
          })(); // 结束异步 IIFE
        }
      } catch (err) {
        // 处理读取或解析存储设置时发生的错误
        showError(`处理存储设置时出错: ${err.message}`); console.error('处理设置出错:', err);
      }
    });
  } catch (err) {
    // 处理 handleOpenPaper 函数入口处的意外错误
    showError(`处理链接时发生意外错误: ${err.message}`); console.error('处理链接出错:', err);
  }
}

/**
 * 从 URL 中提取 DOI (Digital Object Identifier)
 * @param {string} url - 可能包含 DOI 的 URL
 * @returns {string|null} - 提取出的 DOI 字符串，如果未找到则返回 null
 */
function extractDoiFromUrl(url) {
  if (!url) return null;
  // console.log('原始URL:', url);
  const match = url.match(doiRegex); // 使用全局定义的正则表达式进行匹配
  // 如果匹配成功，移除可能存在的 URL 前缀 (如 https://doi.org/)
  const extracted = match ? match[0].replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '') : null;
  // console.log('提取结果:', extracted);
  return extracted;
}

/**
 * 清理文件名，移除或替换不允许的字符
 * @param {string} filename - 原始文件名
 * @returns {string} - 清理后的安全文件名
 */
function sanitizeFilename(filename) {
  if (!filename) return 'downloaded_file'; // 处理空输入
  let sanitized = filename
    .replace(/[\\/:*?"<>|]/g, '_') // 替换 Windows 和 POSIX 系统中的非法字符为下划线
    .replace(/[\x00-\x1F]/g, '')    // 移除 ASCII 控制字符
    .replace(/\s+/g, ' ')           // 将多个连续空白符替换为单个空格
    .trim();                        // 移除首尾空格
  // 处理文件名中的点号，只保留最后一个点（通常用于扩展名）
  const parts = sanitized.split('.');
  if (parts.length > 1) {
      const extension = parts.pop(); // 取出最后一部分作为扩展名
      sanitized = parts.join('_') + '.' + extension; // 将前面的部分用下划线连接，再加上扩展名
  } else {
      // 如果文件名中没有点号（或只有一个点在开头/结尾已被 trim），则将所有剩余的点号替换为下划线
      sanitized = sanitized.replace(/\./g, '_'); 
  }
  return sanitized;
}


// ========= Offscreen API 相关 =========

/**
 * 确保 Offscreen 文档存在。如果不存在，则创建它。
 * 用于在后台 Service Worker 中提供 DOM 解析能力。
 * @param {string} path - Offscreen HTML 文件的路径
 */
async function ensureOffscreenDocument(path = OFFSCREEN_DOCUMENT_PATH) {
    // 检查是否已存在具有指定路径的 Offscreen 文档
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(path)]
    }).catch(err => {
        // 捕获查询时可能发生的错误 (例如 Service Worker 不活跃)
        console.warn('检查现有 Offscreen 上下文时出错:', err.message);
        return []; // 出错时假定不存在
    });

    if (existingContexts.length > 0) {
        // console.log('Offscreen 文档已存在。');
        return; // 已存在，无需创建
    }

    // 创建 Offscreen 文档
    console.log('正在创建 Offscreen 文档...');
    // 使用 chrome.offscreen.createDocument API
    await chrome.offscreen.createDocument({
        url: path, // 指定 HTML 文件路径
        reasons: [chrome.offscreen.Reason.DOM_PARSER], // 声明创建原因 (需要解析 DOM)
        justification: '使用 DOMParser 解析 Sci-Hub 页面的 HTML 字符串以提取引用信息。' // 必须提供创建理由
    }).catch(err => {
        // 处理创建 Offscreen 文档时可能发生的错误
        console.error('创建 Offscreen 文档时出错:', err);
        // 这里可以根据需要添加错误处理或重试逻辑
    });
    console.log('Offscreen 文档创建已发起或完成。');
}


// ========= 下载处理与重命名 =========

// 监听浏览器下载事件：在确定最终文件名前触发
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    // downloadItem 包含下载项信息 (URL, referrer, mime type 等)
    // suggest 是一个函数，用于建议新的文件名 suggest({filename: "new_name.pdf"})
    
    const downloadUrl = downloadItem.url; // 使用下载项的最终 URL 作为标识

    // --- 优先级 1: 检查是否为之前"直接下载"模式缓存的重命名请求 ---
    if (pendingRenames[downloadUrl]) {
        console.log(`检测到来自缓存的待重命名请求 for ${downloadUrl}`);
        const info = pendingRenames[downloadUrl]; // 获取缓存的文献信息
        delete pendingRenames[downloadUrl]; // 获取后立即从缓存中删除，避免重复处理

        // 检查缓存的信息是否完整
        if (info && info.year && info.title && info.journal) {
            // --- 生成并建议新文件名 (与手动流程相同) ---
            const maxLength = 150; // 文件名基本部分的最大长度限制
            let baseName = `${info.year} - ${info.title} - ${info.journal}`;
            baseName = sanitizeFilename(baseName); // 清理文件名
            // 处理超长文件名
            if (baseName.length > maxLength) {
                let truncated = baseName.substring(0, maxLength).trim();
                const lastSpace = truncated.lastIndexOf(' ');
                if (lastSpace > maxLength - 20) { truncated = truncated.substring(0, lastSpace); }
                baseName = truncated + "..."; // 添加省略号
            }
            // 确保文件扩展名为 .pdf
            let newFilename = baseName;
            const originalExt = downloadItem.filename.substring(downloadItem.filename.lastIndexOf('.')).toLowerCase();
            if (originalExt === '.pdf' && !newFilename.toLowerCase().endsWith('.pdf')) {
                 newFilename += '.pdf'; 
            } else if (!newFilename.toLowerCase().endsWith(originalExt)){
                 newFilename += originalExt; // 保留原始扩展名（如果不是.pdf）
            }

            console.log("建议新文件名 (来自缓存):", newFilename);
            // 调用 suggest 函数，提供新文件名和冲突处理方式 ('uniquify' 会自动添加序号)
            suggest({ filename: newFilename, conflictAction: 'uniquify' });
            return true; // **重要**: 必须返回 true，表示我们将异步调用 suggest
        } else {
            // 如果缓存的信息不完整
            console.warn("缓存的重命名信息不完整，将使用默认文件名 for", downloadUrl);
            // 不调用 suggest()，让浏览器使用默认文件名
            return false; // 返回 false 表示我们不处理这个下载的文件名
        }
    }

    // --- 优先级 2: 处理手动下载或未被缓存的自动下载 (通过 Offscreen API) ---
    // console.log(`非缓存下载，检查 referrer for ${downloadUrl}`);
    // 定义 Sci-Hub 域名匹配规则
    const sciHubPatterns = [
        /^https?:\/\/.*?\.sci-hub\.(se|st|ru|tw|hk|is|ws)(\/|$)/i, // 增加更多域名
        /^https?:\/\/sci-hub\.(se|st|ru|tw|hk|is|ws)(\/|$)/i
    ];
    // 检查下载来源页 (referrer) 是否匹配 Sci-Hub 域名
    const isSciHubReferrer = downloadItem.referrer && sciHubPatterns.some(pattern => pattern.test(downloadItem.referrer));
    const referrerUrl = downloadItem.referrer; // 保存来源页 URL，用于后续 fetch

    // console.log("下载检测 (手动/Offscreen 流程):", { referrer: referrerUrl, isSciHubReferrer });

    // 条件：必须是 PDF 文件，并且来源页是 Sci-Hub
    if (downloadItem.mime === 'application/pdf' && isSciHubReferrer) {
        console.log("检测到应通过 Offscreen 重命名的 Sci-Hub PDF 下载...");
        // 使用异步 IIFE 处理
        (async () => {
            try {
                // 1. 获取来源页面的 HTML 内容
                // console.log(`尝试 fetch referrer (${referrerUrl}) 获取信息...`);
                const response = await fetch(referrerUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
                });
                if (!response.ok) throw new Error(`获取 referrer 页面失败: ${response.status}`);
                const html = await response.text();

                // 2. 确保 Offscreen 文档存在
                await ensureOffscreenDocument(); // 调用之前的函数
                // console.log("向 Offscreen 文档发送 HTML 进行解析...");
                
                // 3. 发送消息给 Offscreen 文档进行解析
                const info = await chrome.runtime.sendMessage({
                    target: 'offscreen', // 明确指定目标是 Offscreen 文档
                    action: 'parseHtml', // 指定动作类型
                    html: html,          // 要解析的 HTML 字符串
                    referrerUrl: referrerUrl // 传递原始 URL 以备后用
                });
                // console.log("从 Offscreen 收到解析结果:", info);

                // 4. 处理 Offscreen 返回的文献信息
                if (info && info.year && info.title && info.journal) {
                    // --- 生成并建议新文件名 (逻辑同上) ---
                    const maxLength = 150;
                    let baseName = `${info.year} - ${info.title} - ${info.journal}`;
                    baseName = sanitizeFilename(baseName);
                    if (baseName.length > maxLength) {
                         let truncated = baseName.substring(0, maxLength).trim();
                         const lastSpace = truncated.lastIndexOf(' ');
                         if (lastSpace > maxLength - 20) { truncated = truncated.substring(0, lastSpace); }
                         baseName = truncated + "...";
                    }
                    let newFilename = baseName;
                    const originalExt = downloadItem.filename.substring(downloadItem.filename.lastIndexOf('.')).toLowerCase();
                    if (originalExt === '.pdf' && !newFilename.toLowerCase().endsWith('.pdf')) {
                         newFilename += '.pdf'; 
                    } else if (!newFilename.toLowerCase().endsWith(originalExt)){
                         newFilename += originalExt;
                    }
                    console.log("建议新文件名 (来自 Offscreen):", newFilename);
                    suggest({ filename: newFilename, conflictAction: 'uniquify' });
                } else {
                    // 如果 Offscreen 未能返回完整信息
                    console.warn("未能从 Offscreen 提取足够信息。将使用默认文件名。 Info:", info);
                    // 不调用 suggest()，使用默认文件名
                }
            } catch (error) {
                // 处理在 Offscreen 流程中发生的错误 (fetch 失败, sendMessage 失败等)
                console.error(`处理 Offscreen 重命名时出错 (${referrerUrl}):`, error);
                // 不调用 suggest()，使用默认文件名
            }
        })();
        return true; // **重要**: 必须返回 true，表示我们将异步调用 suggest
    }

    // --- 其他所有情况 --- 
    // (例如：非 PDF 下载, 非 Sci-Hub 来源, 或前面流程已处理/决定不处理)
    // console.log(`下载 ${downloadUrl} 不满足重命名条件或已被处理。`);
    return false; // 让浏览器使用默认行为
});


// ========= 注入到 Sci-Hub 页面的函数 =========

/**
 * 这个函数会在 Sci-Hub 标签页的上下文中执行 (通过 chrome.scripting.executeScript 注入)
 * 它的目的是：
 * 1. 尝试直接从当前页面的 DOM 中提取文献信息。
 * 2. 尝试找到 PDF 的直接下载链接 (href 或 embed src) 或模拟点击下载按钮。
 * 3. 如果同时获取到了完整信息和直接下载链接，则发送 'downloadAndRenameRequest' 消息给后台。
 * 4. 如果只点击了按钮或链接（无法预知最终 URL），则不发送特定消息，依赖后台的 onDeterminingFilename + Offscreen 流程。
 */
function triggerDownloadInTab() {
  console.log('[Content Script Context] 尝试触发下载并提取信息...');

  // --- 1. 提取文献信息 (使用类似 offscreen.js 的逻辑) ---
  let info = null;
  try {
    const doc = document; // 直接使用当前页面的 document
    const currentUrl = window.location.href;
    let title = '', journal = '', year = '';

    // 策略 1: 解析引用字符串
    const citationElement = doc.getElementById('citation') || Array.from(doc.querySelectorAll('div, p, td')).filter(el => el.innerText.includes('doi:')).sort((a, b) => b.innerText.length - a.innerText.length)[0];
    if (citationElement) {
      const citationText = citationElement.innerText.trim();
      // console.log("[Content Script Context] 找到引用文本:", citationText);
      const yearMatch = citationText.match(/\((\d{4})\)/);
      if (yearMatch && yearMatch[1]) {
          year = yearMatch[1];
          const yearEndIndex = yearMatch.index + yearMatch[0].length;
          let doiIndex = citationText.toLowerCase().lastIndexOf('doi:');
          if (doiIndex === -1) doiIndex = citationText.length;
          const textAfterYear = citationText.substring(yearEndIndex, doiIndex).trim();
          let lastDotIndex = textAfterYear.lastIndexOf('. ');
           if (lastDotIndex === -1) {
              let tempDotIndex = textAfterYear.lastIndexOf('.');
              if (tempDotIndex > 0 && tempDotIndex < textAfterYear.length - 2) { lastDotIndex = tempDotIndex; }
           }
          if (lastDotIndex !== -1) {
              title = textAfterYear.substring(0, lastDotIndex).trim().replace(/^[.]?\s*/, '').replace(/[.]+$/, '').trim();
              journal = textAfterYear.substring(lastDotIndex + 1).trim().replace(/^[.]?\s*/, '').replace(/[.]+$/, '').trim();
          } else {
               title = textAfterYear.replace(/^[.]?\s*/, '').replace(/[.]+$/, '').trim();
               journal = '';
          }
          // console.log("[Content Script Context] 从引用字符串解析:", { year, title, journal });
      } else {
           // console.warn("[Content Script Context] 无法从引用提取年份:", citationText);
      }
    } else {
        // console.warn("[Content Script Context] 未找到引用元素。");
    }

    // 策略 2: Meta 标签
    if (!title) { const metaTitle = doc.querySelector('meta[name="citation_title"]'); if (metaTitle) title = metaTitle.content?.trim(); }
    if (!journal) { const metaJournal = doc.querySelector('meta[name="citation_journal_title"]'); if (metaJournal) journal = metaJournal.content?.trim(); }
    if (!year) { const metaDate = doc.querySelector('meta[name="citation_date"], meta[name="citation_online_date"]'); if (metaDate) { const dateStr = metaDate.content?.trim(); if (dateStr) { const yearMetaMatch = dateStr.match(/^(\d{4})/); if (yearMetaMatch) year = yearMetaMatch[1]; } } }
    
    // 策略 3: URL 年份
     if (!year && currentUrl) { const urlYearMatch = currentUrl.match(/\/(\d{4})-\d{2}-\d{2}\//) || currentUrl.match(/[\/\?&=_-](\d{4})([\/\?&=_-]|$)/); if (urlYearMatch && urlYearMatch[1]) year = urlYearMatch[1]; }

    // 清理并组装
    const illegalCharsRegex = /[\\/:*?"<>|]/g;
    title = (title || '').replace(/[.\s]+$/,'').replace(illegalCharsRegex, '_').trim();
    journal = (journal || '').replace(/[.\s]+$/,'').replace(illegalCharsRegex, '_').trim();
    year = (year || '').replace(illegalCharsRegex, '_').trim();

    if (year && title && journal) {
        info = { year, title, journal };
        console.log("[Content Script Context] 成功提取信息:", info);
    } else {
        console.warn("[Content Script Context] 未能提取完整信息。", { year, title, journal });
        info = null;
    }

  } catch (e) {
    console.error("[Content Script Context] 提取信息时出错:", e);
    info = null;
  }

  // --- 2. 查找下载元素并获取 URL 或触发点击 ---
  console.log("[Content Script Context] 正在查找下载元素...");
  const selectors = [
      '#buttons a[href*=".pdf"]',       // 按钮区域 PDF 链接
      '#downloads a[href*=".pdf"]',    // 下载区域 PDF 链接
      'article a[href*=".pdf"]',        // 文章内 PDF 链接
      // 'a:has(button:contains("Save"))', // :has 可能不被所有浏览器支持
      'button:contains("Download")',     // "Download" 按钮
      'button:contains("Save")',         // "Save" 按钮
      'a[onclick*="location.href="]',   // JS 跳转链接
      'embed[type="application/pdf"]'    // 嵌入的 PDF
  ];
  let downloadUrl = null; // 存储找到的直接下载 URL
  let clickedElement = false; // 标记是否点击了某个元素 (按钮或非直接链接)

  for (const selector of selectors) {
      try {
          const element = document.querySelector(selector);
          if (element) {
              console.log(`[Content Script Context] 找到元素匹配: ${selector}`);
              // 情况 A: 找到嵌入的 PDF
              if (selector === 'embed[type="application/pdf"]' && element.src) {
                  downloadUrl = element.src;
                  console.log(`[Content Script Context] 获取到 embed src: ${downloadUrl}`);
                  break; // 找到 embed src，优先使用，停止查找
              }
              // 情况 B: 找到明确指向 .pdf 的链接
              else if (element.href && element.href.toLowerCase().includes('.pdf')) {
                  downloadUrl = element.href;
                   console.log(`[Content Script Context] 获取到直接 PDF 链接: ${downloadUrl}`);
                  // 通常不需要点击这种链接，直接用 URL 下载更好
                  // element.click(); 
                  break; // 找到直接 PDF 链接，停止查找
              }
              // 情况 C: 找到其他链接 (可能是 JS 跳转或需要点击)
              else if (element.href) { 
                  console.log(`[Content Script Context] 找到其他链接，尝试点击: ${element.href}`);
                  element.click(); // 模拟点击
                  clickedElement = true; // 标记为已点击，后续依赖 Offscreen 流程
                  break; // 点击了一个链接，停止查找
              }
              // 情况 D: 找到按钮
              else if (element.tagName === 'BUTTON') {
                   console.log(`[Content Script Context] 找到按钮，尝试点击...`);
                   element.click(); // 模拟点击
                   clickedElement = true; // 标记为已点击，后续依赖 Offscreen 流程
                   break; // 点击了一个按钮，停止查找
              }
          }
      } catch(e) { /* 忽略无效的选择器错误 */ }
  }

  // --- 3. 根据结果发送消息给后台 --- 
  // 条件：必须成功提取了 *完整* 的文献信息，*并且* 找到了一个 *直接* 的下载 URL (href 或 src)
  if (info && downloadUrl) {
      console.log("[Content Script Context] 发送 downloadAndRenameRequest (包含信息和直接 URL)...");
      // 发送包含 URL 和提取信息的请求给后台
      chrome.runtime.sendMessage({ action: 'downloadAndRenameRequest', url: downloadUrl, info: info });
  } 
  // 条件：如果点击了某个元素（按钮或其他链接），但没有获取到直接 URL，或者信息提取不完整
  else if (clickedElement) {
      console.log("[Content Script Context] 已点击元素，但无直接 URL 或信息不全，依赖后续 Offscreen 重命名流程。");
      // 不发送特定消息，让后台的 onDeterminingFilename + Offscreen 机制处理这次下载
  } 
  // 条件：如果找到了直接 URL，但信息提取不完整
  else if (downloadUrl && !info) {
      console.warn("[Content Script Context] 找到直接 URL 但信息提取不完整，将尝试直接下载（可能无重命名）。");
      // 方案 A: 直接让后台下载，但不保证重命名（依赖 Offscreen，但 referrer 可能丢失）
       chrome.runtime.sendMessage({ action: 'downloadAndRenameRequest', url: downloadUrl, info: null }); // 发送 null info
      // 方案 B: 不发送消息，让 onDeterminingFilename 发现 referrer 为空且无缓存，使用默认名（更安全）
  } 
  // 条件：如果既没找到 URL，也没点击任何元素
  else {
      console.warn('[Content Script Context] 最终未找到可用的下载元素或链接。');
      // 这种情况无法触发下载
  }
}


// ========= 初始化和启动信息 =========

console.log("后台脚本 (background.js) 已加载并运行。");
// 可以在这里添加其他的初始化代码，例如检查更新等
