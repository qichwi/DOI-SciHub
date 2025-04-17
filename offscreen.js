// offscreen.js
// 这个脚本运行在一个独立的、隐藏的 Offscreen 文档中。
// 主要目的是利用 Offscreen 环境提供的 DOM 解析能力 (DOMParser)
// 来解析从 background.js 传来的 Sci-Hub 页面 HTML 字符串，以提取文献信息。

/**
 * 从解析后的 Sci-Hub 页面 DOM 中提取文献信息（标题、期刊、年份）。
 * @param {Document} doc - 由 DOMParser 解析生成的 HTML 文档对象。
 * @param {string} referrerUrl - 原始的 Sci-Hub 页面 URL，用于后备提取年份。
 * @returns {{year: string, title: string, journal: string} | null} - 包含年份、标题、期刊的对象，如果提取失败或信息不全则返回 null。
 */
function extractSciHubInfoFromDOM(doc, referrerUrl) {
    console.log("[Offscreen] 开始从 DOM 提取信息...");
    try {
        let title = '', journal = '', year = '';

        // --- 策略 1: 尝试从标准引用元素（如 <div id="citation">）或包含 "doi:" 的最长文本元素中提取和解析 --- 
        const citationElement = doc.getElementById('citation'); // 查找 ID 为 citation 的元素
        let citationText = ''; // 用于存储找到的引用文本
        if (citationElement) {
            citationText = citationElement.innerText.trim(); // 获取其纯文本内容并去除首尾空格
        } else {
            // 如果没有 id="citation"，则查找所有包含 "doi:" 的 div, p, td 元素
            const doiElements = Array.from(doc.querySelectorAll('div, p, td')).filter(el => el.innerText.includes('doi:'));
            if (doiElements.length > 0) {
                // 如果找到多个，按文本长度降序排序，取最长的一个作为引用文本
                doiElements.sort((a, b) => b.innerText.length - a.innerText.length);
                citationText = doiElements[0].innerText.trim();
            }
        }

        // 如果找到了引用文本，尝试从中解析 年份、标题、期刊
        if (citationText) {
            console.log("[Offscreen] 找到引用文本，尝试解析:", citationText);
            // 1. 提取年份：匹配括号中的四位数字 (YYYY)
            const yearMatch = citationText.match(/\((\d{4})\)/);
            if (yearMatch && yearMatch[1]) {
                year = yearMatch[1]; // 提取年份
                const yearEndIndex = yearMatch.index + yearMatch[0].length; // 记录年份在字符串中的结束位置
                
                // 2. 确定引用文本的有效结束位置：通常是最后一个 "doi:" 之前
                let doiIndex = citationText.toLowerCase().lastIndexOf('doi:');
                if (doiIndex === -1) doiIndex = citationText.length; // 如果没有 "doi:"，则处理到字符串末尾
                
                // 3. 获取年份之后、doi之前的部分，这部分通常包含标题和期刊
                const textAfterYear = citationText.substring(yearEndIndex, doiIndex).trim();
                
                // 4. 尝试分割标题和期刊：通常以最后一个". " (点+空格) 作为分隔符
                let lastDotIndex = textAfterYear.lastIndexOf('. ');
                
                 // 5. 如果找不到". "，尝试找最后一个"."，但需要一些条件避免误判
                 if (lastDotIndex === -1) {
                    let tempDotIndex = textAfterYear.lastIndexOf('.');
                    // 条件：点号不能是字符串的开头或结尾（或非常接近结尾），以排除句末句号等情况
                    if (tempDotIndex > 0 && tempDotIndex < textAfterYear.length - 2) { 
                         lastDotIndex = tempDotIndex; // 使用这个点作为分隔符
                    }
                 }

                // 6. 根据找到的分隔符提取标题和期刊
                if (lastDotIndex !== -1) {
                    // 分隔符之前是标题，之后是期刊
                    // 清理：移除可能的前导点和空格，移除末尾的点和空格
                    title = textAfterYear.substring(0, lastDotIndex).trim().replace(/^[.]?\s*/, '').replace(/[.]+$/, '').trim();
                    journal = textAfterYear.substring(lastDotIndex + 1).trim().replace(/^[.]?\s*/, '').replace(/[.]+$/, '').trim();
                } else {
                     // 如果找不到合适的分隔符，将年份后的全部内容视为标题，期刊设为空
                     console.warn("[Offscreen] 无法明确分离标题和期刊，将年份后内容视为标题。");
                     title = textAfterYear.replace(/^[.]?\s*/, '').replace(/[.]+$/, '').trim();
                     journal = ''; // 明确设为空字符串
                }
                console.log("[Offscreen] 从引用字符串解析结果:", { year, title, journal });
            } else {
                 console.warn("[Offscreen] 无法从引用字符串中提取年份:", citationText);
            }
        }

        // --- 策略 2: 后备 - 从 Meta 标签获取 (如果策略1未能获取完整信息) ---
        // HTML 的 <meta> 标签有时会包含规范的文献信息
        if (!title) { // 如果标题为空
            const metaTitle = doc.querySelector('meta[name="citation_title"]'); // 查找 name="citation_title" 的 meta 标签
            if (metaTitle) {
                 title = metaTitle.getAttribute('content')?.trim(); // 获取其 content 属性值
                 if (title) console.log("[Offscreen] 从 meta 获取标题:", title);
            }
        }
        if (!journal) { // 如果期刊为空
            const metaJournal = doc.querySelector('meta[name="citation_journal_title"]'); // 查找 name="citation_journal_title"
            if (metaJournal) {
                 journal = metaJournal.getAttribute('content')?.trim();
                 if (journal) console.log("[Offscreen] 从 meta 获取期刊:", journal);
            }
        }
        if (!year) { // 如果年份为空
            // 尝试查找 name="citation_date" 或 name="citation_online_date"
            const metaYear = doc.querySelector('meta[name="citation_date"], meta[name="citation_online_date"]');
            if (metaYear) {
                const dateStr = metaYear.getAttribute('content')?.trim(); // 获取日期字符串
                if (dateStr) {
                    // 从日期字符串开头提取四位数字作为年份
                    const yearMetaMatch = dateStr.match(/^(\d{4})/);
                    if (yearMetaMatch) {
                        year = yearMetaMatch[1];
                        console.log("[Offscreen] 从 meta 获取年份:", year);
                    }
                }
            }
        }
        
         // --- 策略 3: 后备 - 从 URL 提取年份 (如果年份仍然缺失) --- 
         // 有些 Sci-Hub 页面的 URL 结构可能包含年份信息
         if (!year && referrerUrl) { // 仅当年份为空且传入了 URL 时尝试
            // 尝试匹配 URL 中常见的日期格式，如 /YYYY-MM-DD/
            const urlYearMatch = referrerUrl.match(/\/(\d{4})-\d{2}-\d{2}\//);
            // 或者尝试匹配 URL 中其他位置由非数字字母分隔的四位数字
            const genericUrlYearMatch = referrerUrl.match(/[\/\?&=_-](\d{4})([\/\?&=_-]|$)/);
            
            if (urlYearMatch && urlYearMatch[1]) {
                year = urlYearMatch[1];
                 console.log("[Offscreen] 从 URL (YYYY-MM-DD 格式) 获取年份:", year);
            } else if (genericUrlYearMatch && genericUrlYearMatch[1]){
                 year = genericUrlYearMatch[1];
                 console.log("[Offscreen] 从 URL (通用匹配) 获取年份:", year);
            }
         }

        // --- 最终检查和清理 --- 
        // 检查是否成功获取了所有三个关键信息：标题、期刊、年份
        if (!title || !journal || !year) {
            console.warn("[Offscreen] 未能提取完整的论文信息。 Info:", { title, journal, year });
            return null; // 如果信息不完整，返回 null
        }

        // 清理提取到的信息，移除文件名中不允许的字符，并提供默认值以防万一
        const illegalCharsRegex = /[\\/:*?"<>|]/g; // 定义非法字符正则表达式
        // 清理逻辑: 移除末尾的点号和空格，将非法字符替换为下划线，去除首尾空格，如果结果为空则使用默认值
        title = title.replace(/[.\s]+$/,'').replace(illegalCharsRegex, '_').trim() || "UnknownTitle";
        journal = journal.replace(/[.\s]+$/,'').replace(illegalCharsRegex, '_').trim() || "UnknownJournal";
        year = year.replace(illegalCharsRegex, '_').trim() || "UnknownYear";

        console.log("[Offscreen] 清理并准备返回的信息:", { year, title, journal });
        // 返回包含清理后信息的对象
        return { year, title, journal };

    } catch (error) {
        // 捕获在提取过程中可能发生的任何错误
        console.error("[Offscreen] 在解析 DOM 或处理信息时出错:", error);
        return null; // 发生错误时返回 null
    }
}

// --- 消息监听器 --- 
// 设置监听器，等待来自 background.js 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 检查消息是否是发往 Offscreen 文档 (`target === 'offscreen'`) 
    // 并且请求的操作是解析 HTML (`action === 'parseHtml'`)。
    // 这是为了确保只处理预期的消息类型，避免处理其他扩展或组件发送的消息。
    if (message.target === 'offscreen' && message.action === 'parseHtml') { 
        console.log("[Offscreen] 收到来自后台的 HTML 解析请求");
        
        // 1. 创建 DOMParser 实例
        const parser = new DOMParser();
        
        // 2. 解析 background.js 发来的 HTML 字符串
        //    message.html 包含了 Sci-Hub 页面的完整 HTML 内容
        //    'text/html' 指定了解析模式
        const doc = parser.parseFromString(message.html, 'text/html');
        
        // 3. 调用上面定义的函数，从解析后的 DOM 中提取信息
        //    将解析后的文档对象 (doc) 和原始 URL (message.referrerUrl) 传给提取函数
        const info = extractSciHubInfoFromDOM(doc, message.referrerUrl);
        
        // 4. 将提取结果发送回 background.js
        //    sendResponse 是一个回调函数，用于将结果异步返回给消息发送者
        //    如果 info 为 null (提取失败)，也会将 null 发送回去
        console.log("[Offscreen] 解析完成，将结果发送回后台:", info);
        sendResponse(info); 
        
    } else {
        // 如果收到的消息不符合预期 (target 或 action 不匹配)
        console.log("[Offscreen] 收到非预期消息或 action 不匹配, 已忽略:", message);
        // 在这种情况下，可以选择不调用 sendResponse，或者调用 sendResponse(null) 或 sendResponse(undefined)
        // 以明确表示没有处理这个消息或没有结果返回。
        // sendResponse(null); 
    }
    
    // **重要**: 在 onMessage 监听器中，如果需要异步调用 sendResponse (即使本例中是同步调用后返回)，
    // 也应该返回 true。这会通知 Chrome 扩展系统，保持消息通道开放，直到 sendResponse 被调用。
    // 如果不返回 true 或返回 false/undefined，消息通道可能会在 sendResponse 调用前关闭，导致发送失败。
    return true; 
});

console.log("[Offscreen] Offscreen 脚本 (offscreen.js) 已加载并准备就绪。"); 