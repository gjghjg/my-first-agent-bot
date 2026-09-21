/**
 * RSS 推送飞书 Bot 脚本
 * 功能：从 CloudFlare AI Insight Daily RSS 获取最新日报并推送到飞书
 */

const RSS_URL = 'https://justlovemaki.github.io/CloudFlare-AI-Insight-Daily/rss.xml';
const LLM_API_KEY = process.env.LLM_API_KEY;
const FEISHU_WEBHOOK_URL = process.env.FEISHU_WEBHOOK_URL;

/**
 * 发送消息到飞书
 * @param {string} title - 消息标题
 * @param {string} content - 消息内容
 * @param {string} link - 链接地址
 */
async function sendToFeishu(title, content, link) {
  if (!FEISHU_WEBHOOK_URL) {
    throw new Error('FEISHU_WEBHOOK_URL 环境变量未设置');
  }

  // 构建飞书卡片消息格式
  const cardData = {
    msg_type: 'interactive',
    card: {
      header: {
        title: {
          tag: 'plain_text',
          content: `🤖 AI资讯日报 - ${title}`
        },
        template: 'blue'
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'plain_text',
            content: content
          }
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: {
                tag: 'plain_text',
                content: '📖 阅读完整日报'
              },
              type: 'default',
              url: link
            },
            {
              tag: 'button',
              text: {
                tag: 'plain_text',
                content: '🌐 访问官网'
              },
              type: 'default',
              url: 'https://ai.hubtoday.app/'
            }
          ]
        }
      ]
    }
  };

  const response = await fetch(FEISHU_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(cardData)
  });

  if (!response.ok) {
    throw new Error(`飞书推送失败: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  console.log('✅ 飞书推送成功:', result);
  return result;
}

/**
 * 解析 RSS 并获取最新的日报项
 */
async function fetchLatestRSSItem() {
  console.log('📡 正在获取 RSS:', RSS_URL);

  const response = await fetch(RSS_URL);
  if (!response.ok) {
    throw new Error(`RSS 请求失败: ${response.status}`);
  }

  const rssText = await response.text();

  // 简单的 XML 解析
  const itemMatch = rssText.match(/<item>([\s\S]*?)<\/item>/);
  if (!itemMatch) {
    throw new Error('RSS 格式错误：未找到 item');
  }

  const itemContent = itemMatch[1];

  // 提取标题
  const titleMatch = itemContent.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
  const title = titleMatch ? titleMatch[1] : 'AI资讯日报';

  // 提取链接
  const linkMatch = itemContent.match(/<link>(.*?)<\/link>/);
  const link = linkMatch ? linkMatch[1] : 'https://ai.hubtoday.app/';

  // 提取完整内容（content:encoded，包含 HTML 结构）
  const contentMatch = itemContent.match(/<content:encoded><!\[CDATA\[(.*?)\]\]><\/content:encoded>/);
  const description = contentMatch ? contentMatch[1] : '';

  // 提取发布日期
  const pubDateMatch = itemContent.match(/<pubDate>(.*?)<\/pubDate>/);
  const pubDate = pubDateMatch ? pubDateMatch[1] : new Date().toLocaleString('zh-CN');

  console.log('✅ RSS 解析成功');
  console.log('📰 标题:', title);
  console.log('📅 发布时间:', pubDate);

  return { title, link, description, pubDate };
}

/**
 * 智能解析并格式化日报内容
 */
function formatDailyReport(item) {
  const { title, link, description, pubDate } = item;

  // 解析 HTML 格式的内容
  const sections = parseHTMLContent(description);

  // 格式化为飞书纯文本格式
  const content = `📅 发布时间：${pubDate}

${sections.map(section => formatSection(section)).join('\n\n')}

══════════════════════════════
💡 点击下方按钮查看完整内容
🤖 由 CloudFlare AI Insight Daily 自动生成
══════════════════════════════`;

  return {
    title: title.replace(/【.*?】/g, '').trim(),
    content,
    link
  };
}

/**
 * 调用大模型进行智能总结
 */
async function summarizeWithAI(htmlContent) {
  if (!LLM_API_KEY) {
    console.log('⚠️ 未配置 LLM_API_KEY，跳过 AI 总结');
    return htmlContent;
  }

  console.log('🧠 正在请求大模型进行智能总结...');
  
  // 构造给大模型的提示词（Prompt）
 const prompt = `你是一个资深的AI行业新闻秘书。下面是你抓取到的最新原始 HTML 代码。
这个代码里可能包含了过去几天的日报内容，并且可能存在重复。

请你严格按照以下要求操作：
1. 不要输出全部的原始内容，只输出一份精简的简报。
2. 你必须只提取【最新日期】的那一份日报进行总结，绝对不要包含过去几天的内容。如果抓取到的内容是昨天的，那就直接总结昨天的，但要明确这是最新的一天。
3. 如果正文中出现了完全一样的段落或内容，请直接丢弃重复部分，绝对不要重复输出。
4. 提炼出最核心的3-5条新闻。
5. 每条新闻保留原链接（如果有的话）。
6. 最后用一句话点评今天的整体趋势。
7. 直接输出最终结果，不要客套话，不要包含HTML标签。

原始内容：
${htmlContent}`;

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.7
    })
  });

  if (!response.ok) {
    console.log('❌ 大模型调用失败，降级为直接发送原文');
    return htmlContent;
  }

  const data = await response.json();
  const aiText = data.choices[0].message.content;
  console.log('✅ 大模型总结完成');
  return aiText;
}

/**
 * 解析 HTML 格式的日报内容
 */
function parseHTMLContent(html) {
  const sections = [];

  // 匹配所有 <h3> 标题和其后的 <ol><li> 列表
  const h3Regex = /<h3>(.*?)<\/h3>([\s\S]*?)(?=<h3>|$)/g;
  let match;

  while ((match = h3Regex.exec(html)) !== null) {
    const sectionTitle = match[1].trim();
    const sectionContent = match[2];

    // 🚨 改造开始：使用 Set 自动去重，防止一份内容被总结两遍
    const itemsSet = new Set(); 
    const liRegex = /<li>(.*?)<\/li>/g;
    let liMatch;

    while ((liMatch = liRegex.exec(sectionContent)) !== null) {
      const itemText = liMatch[1]
        .replace(/<[^>]+>/g, '') // 移除 HTML 标签
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .trim();

      if (itemText && !itemText.includes('剩余内容已省略')) {
        itemsSet.add(itemText); // 使用 add 而不是 push，一模一样的文字会被自动忽略
      }
    }

    // 将去重后的 Set 转换回数组
    const items = Array.from(itemsSet); 
    // 🚨 改造结束

    if (items.length > 0) {
      sections.push({
        title: sectionTitle,
        items
      });
    }
  }

  return sections;
}

/**
 * 格式化单个段落（纯文本格式）
 */
function formatSection(section) {
  const icons = {
    '产品': '🚀',
    '功能': '⚡',
    '更新': '🔥',
    '研究': '🔬',
    '论文': '📄',
    '开源': '💻',
    '模型': '🤖',
    '工具': '🛠️',
    '安全': '🔒',
    '投资': '💰',
    '应用': '📱',
    '政策': '📜',
    '数据': '📊',
    '行业': '🌐',
    '社会': '👥',
    '默认': '📌'
  };

  // 根据标题选择合适的图标
  let icon = icons['默认'];
  for (const [keyword, emoji] of Object.entries(icons)) {
    if (keyword !== '默认' && section.title.includes(keyword)) {
      icon = emoji;
      break;
    }
  }

  // 格式化 items，使用圆点编号（更简洁）
  const itemsText = section.items
    .map(item => `  • ${item}`)
    .join('\n');

  return `─────────────────────
${icon} ${section.title}
─────────────────────
${itemsText}`;
}

/**
 * 格式化日期为更友好的格式
 */
function formatDate(pubDate) {
  try {
    const date = new Date(pubDate);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const dateStr = date.toLocaleString('zh-CN', {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    if (diffDays === 0) {
      return `今天 ${dateStr}`;
    } else if (diffDays === 1) {
      return `昨天 ${dateStr}`;
    } else {
      return dateStr;
    }
  } catch (e) {
    return pubDate;
  }
}

/**
 * 主函数
 */
async function main() {
  try {
    console.log('🚀 开始执行 RSS 推送任务');
    console.log('===========================================');

    // 1. 获取最新日报
    const latestItem = await fetchLatestRSSItem();

    // 2. 格式化内容
    // 原来：
// const { title, content, link } = formatDailyReport(latestItem);
// await sendToFeishu(title, content, link);

// 改成：
let finalContent;
if (LLM_API_KEY) {
  finalContent = await summarizeWithAI(latestItem.description); // 把原始HTML扔给AI总结
} else {
  const formatted = formatDailyReport(latestItem); // 降级方案：用原来的本地正则
  finalContent = formatted.content;
}


    console.log('📝 消息已格式化');
    console.log('📤 准备推送到飞书...');

    // 3. 推送到飞书
    //await sendToFeishu(latestItem.title, finalContent, latestItem.link);
    console.log('===========================================');
    console.log('✅ 任务完成！日报已成功推送到飞书');

  } catch (error) {
    console.error('❌ 任务失败:', error.message);
    throw error;
  }
}

// 导出函数供测试使用
module.exports = {
  main,
  fetchLatestRSSItem,
  formatDailyReport,
  sendToFeishu,
  summarizeWithAI
};

// 如果直接运行此脚本
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
