require('dotenv').config();

const lark = require('@larksuiteoapi/node-sdk');
const {
  fetchLatestRSSItem,
  summarizeWithAI,
  formatDailyReport
} = require('./rss-bot.js');

// 临时调试：看看环境变量有没有读到
console.log('环境变量检查:', {
  hasAppId: !!process.env.LARK_APP_ID,
  hasAppSecret: !!process.env.LARK_APP_SECRET,
  hasLlmKey: !!process.env.LLM_API_KEY
});

const client = new lark.Client({ ... });
// 创建飞书客户端，用来发消息
const client = new lark.Client({
  appId: process.env.LARK_APP_ID,
  appSecret: process.env.LARK_APP_SECRET,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

// 获取日报内容
async function getDailyReportText() {
  const latestItem = await fetchLatestRSSItem();

  let finalContent;
  if (process.env.LLM_API_KEY) {
    finalContent = await summarizeWithAI(latestItem.description);
  } else {
    const formatted = formatDailyReport(latestItem);
    finalContent = formatted.content;
  }

  let text = `📰 ${latestItem.title}\n\n${finalContent}\n\n🔗 ${latestItem.link}`;

  // 飞书文本消息太长会失败，简单截断
  if (text.length > 3000) {
    text = text.slice(0, 3000) + '\n\n...内容太长已截断';
  }

  return text;
}

// 发送文本消息
async function sendText(chatId, text) {
  await client.im.message.create({
    params: {
      receive_id_type: 'chat_id'
    },
    data: {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text })
    }
  });
}

// 注册事件处理器
const processedMessageIds = new Set();

const eventDispatcher = new lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data) => {
    const message = data.message;
    const chatId = message.chat_id;
    const messageId = message.message_id;

    // 去重：同一条消息只处理一次
    if (processedMessageIds.has(messageId)) {
      console.log('重复消息，已跳过:', messageId);
      return;
    }
    processedMessageIds.add(messageId);

    // 防止 Set 无限增长
    if (processedMessageIds.size > 1000) {
      const first = processedMessageIds.values().next().value;
      processedMessageIds.delete(first);
    }

    const content = JSON.parse(message.content);
    const text = (content.text || '').trim();

    console.log('收到消息:', text);

    if (text.includes('/ping')) {
      await sendText(chatId, 'pong');
      return;
    }

    if (text.includes('/help')) {
      await sendText(chatId, '可用命令：\n/ai 今日AI日报\n/ping 测试\n/help 帮助');
      return;
    }

    if (text.includes('/ai')) {
      await sendText(chatId, '⏳ 正在抓取并总结，请稍等...');

      try {
        const report = await getDailyReportText();
        await sendText(chatId, report);
      } catch (error) {
        await sendText(chatId, '❌ 日报获取失败：' + error.message);
      }
      return;
    }

    await sendText(chatId, '我没听懂。发送 /help 查看命令。');
  },
});

// 启动长连接
const wsClient = new lark.WSClient({
  appId: process.env.LARK_APP_ID,
  appSecret: process.env.LARK_APP_SECRET,
});

wsClient.start({ eventDispatcher });

console.log('🤖 飞书命令机器人已启动，等待消息...');
