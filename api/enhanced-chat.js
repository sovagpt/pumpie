// Enhanced PUMPIE FM with Topic Queue and Memory System
// api/enhanced-chat.js

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'POST') {
    return await handleChatGeneration(req, res);
  } else if (req.method === 'GET') {
    return await handleDataRetrieval(req, res);
  } else if (req.method === 'DELETE') {
    return await handleDataDeletion(req, res);
  }

  res.status(405).json({ error: 'Method not allowed' });
}

async function handleChatGeneration(req, res) {
  try {
    const { cryptoData, requestType = 'segment', fieldIntel, action } = req.body;
    
    console.log('🎙️ Generating content...', { action, cryptoData, requestType, fieldIntel });
    console.log('📝 Request body:', JSON.stringify(req.body, null, 2));
    
    if (action === 'add_topic') {
      await addTopicToQueue(req.body.topic);
      return res.status(200).json({ success: true, message: 'Topic added to queue' });
    }
    
    // Get memory and topic queue
    const memory = await getMemoryData();
    const topicQueue = await getTopicQueue();
    
    // Decide what to talk about
    let topicToDiscuss = null;
    if (fieldIntel) {
      topicToDiscuss = { content: fieldIntel, type: 'breaking_news', priority: 'urgent' };
    } else if (topicQueue.length > 0) {
      topicToDiscuss = await getNextTopic();
    }
    
    // Generate contextual content
    const content = await generateEnhancedContent({
      cryptoData,
      memory,
      topicToDiscuss,
      requestType
    });
    
    // Store what Pumpie talked about in memory
    await storeMemory({
      timestamp: Date.now(),
      content,
      topic: topicToDiscuss,
      cryptoPrices: cryptoData?.slice(0, 3) || [],
      type: requestType,
      keywords: extractKeywords(content)
    });
    
    res.status(200).json({ 
      content,
      metadata: {
        topicDiscussed: topicToDiscuss,
        queueLength: topicQueue.length,
        memoryEntries: memory.recent.length,
        hasKnowledge: memory.knowledge.length
      }
    });
    
  } catch (error) {
    console.error('Enhanced chat error:', error);
    res.status(500).json({ error: 'Failed to generate content' });
  }
}

async function handleDataRetrieval(req, res) {
  try {
    const { type } = req.query;
    
    if (type === 'queue') {
      const queue = await getTopicQueue();
      res.status(200).json({ queue });
    } else if (type === 'memory') {
      const memory = await getMemoryData();
      res.status(200).json({ memory });
    } else if (type === 'knowledge') {
      const knowledge = await getKnowledgeBase();
      res.status(200).json({ knowledge });
    } else {
      const [queue, memory, knowledge] = await Promise.all([
        getTopicQueue(),
        getMemoryData(), 
        getKnowledgeBase()
      ]);
      res.status(200).json({ queue, memory, knowledge });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve data' });
  }
}

async function handleDataDeletion(req, res) {
  try {
    const { type, id } = req.query;
    
    if (type === 'topic' && id) {
      await removeTopicFromQueue(id);
      res.status(200).json({ success: true });
    } else if (type === 'memory') {
      await clearMemory();
      res.status(200).json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid deletion request' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete data' });
  }
}

async function getTopicQueue() {
  try {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    
    const queue = await redis.lrange('pumpie:topic_queue', 0, -1);
    return queue.map(item => {
      try {
        return typeof item === 'string' ? JSON.parse(item) : item;
      } catch {
        return { content: item, timestamp: Date.now(), id: Date.now() };
      }
    });
  } catch (error) {
    console.log('Topic queue retrieval failed:', error);
    return [];
  }
}

async function addTopicToQueue(topic) {
  try {
    console.log('📋 Adding topic to queue:', topic);
    
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    
    const topicItem = {
      id: Date.now(),
      content: topic.content,
      type: topic.type || 'general',
      priority: topic.priority || 'normal',
      timestamp: Date.now(),
      tags: topic.tags || [],
      reporter: topic.reporter || 'pumpie'
    };
    
    console.log('📋 Topic item to store:', topicItem);
    
    if (topic.priority === 'urgent') {
      await redis.lpush('pumpie:topic_queue', JSON.stringify(topicItem));
    } else {
      await redis.rpush('pumpie:topic_queue', JSON.stringify(topicItem));
    }
    
    // Verify it was added
    const queueLength = await redis.llen('pumpie:topic_queue');
    console.log(`✅ Topic added to queue. Queue length: ${queueLength}`);
    
  } catch (error) {
    console.error('⚠ Topic queue storage failed:', error);
  }
}

async function getNextTopic() {
  try {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    
    const topicData = await redis.lpop('pumpie:topic_queue');
    if (topicData) {
      return typeof topicData === 'string' ? JSON.parse(topicData) : topicData;
    }
    return null;
  } catch (error) {
    console.log('Get next topic failed:', error);
    return null;
  }
}

async function removeTopicFromQueue(topicId) {
  try {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    
    const queue = await redis.lrange('pumpie:topic_queue', 0, -1);
    await redis.del('pumpie:topic_queue');
    
    const filteredQueue = queue.filter(item => {
      const parsed = typeof item === 'string' ? JSON.parse(item) : item;
      return parsed.id !== parseInt(topicId);
    });
    
    for (const item of filteredQueue) {
      await redis.rpush('pumpie:topic_queue', typeof item === 'string' ? item : JSON.stringify(item));
    }
    
    console.log('✅ Topic removed from queue');
  } catch (error) {
    console.log('Topic removal failed:', error);
  }
}

async function getMemoryData() {
  try {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    
    const recent = await redis.lrange('pumpie:memory', 0, 19); // Last 20 segments
    const knowledge = await redis.lrange('pumpie:knowledge', 0, 49); // Last 50 knowledge items
    
    return {
      recent: recent.map(item => {
        try {
          return typeof item === 'string' ? JSON.parse(item) : item;
        } catch {
          return { timestamp: Date.now(), content: 'Parse error' };
        }
      }),
      knowledge: knowledge.map(item => {
        try {
          return typeof item === 'string' ? JSON.parse(item) : item;
        } catch {
          return { timestamp: Date.now(), content: 'Parse error' };
        }
      })
    };
  } catch (error) {
    console.log('Memory retrieval failed:', error);
    return { recent: [], knowledge: [] };
  }
}

async function storeMemory(memoryItem) {
  try {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    
    // Store in recent memory
    await redis.lpush('pumpie:memory', JSON.stringify(memoryItem));
    await redis.ltrim('pumpie:memory', 0, 19); // Keep last 20
    
    // Extract and store knowledge
    if (memoryItem.topic && memoryItem.topic.content) {
      const knowledgeItem = {
        timestamp: Date.now(),
        topic: memoryItem.topic.content,
        context: memoryItem.content.substring(0, 200),
        keywords: memoryItem.keywords,
        type: memoryItem.topic.type || 'general'
      };
      
      await redis.lpush('pumpie:knowledge', JSON.stringify(knowledgeItem));
      await redis.ltrim('pumpie:knowledge', 0, 49); // Keep last 50
    }
    
    console.log('✅ Memory and knowledge stored');
  } catch (error) {
    console.log('Memory storage failed:', error);
  }
}

async function getKnowledgeBase() {
  try {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    
    const knowledge = await redis.lrange('pumpie:knowledge', 0, -1);
    return knowledge.map(item => {
      try {
        return typeof item === 'string' ? JSON.parse(item) : item;
      } catch {
        return { timestamp: Date.now(), topic: 'Parse error' };
      }
    });
  } catch (error) {
    console.log('Knowledge retrieval failed:', error);
    return [];
  }
}

async function clearMemory() {
  try {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    
    await redis.del('pumpie:memory');
    await redis.del('pumpie:knowledge');
    await redis.del('pumpie:topic_queue');
    console.log('🧹 All data cleared');
  } catch (error) {
    console.log('Clear memory failed:', error);
  }
}

async function generateEnhancedContent({ cryptoData, memory, topicToDiscuss, requestType }) {
  const contextPrompt = buildContextPrompt(memory, topicToDiscuss);
  
  const prompt = `You are Pumpie, the legendary pump.fun mascot DJ of PUMPIE FM 24.7 - the underground memecoin radio station.

CRITICAL INSTRUCTIONS:
- NEVER use asterisks or action descriptions like "*chuckles*" or "*excitedly*"
- Write ONLY what Pumpie actually SAYS out loud
- No stage directions, no emotional descriptions in asterisks
- Pure spoken dialogue only
- Be natural and conversational

PUMPIE'S PERSONALITY:
- Street-smart pump.fun expert with vast knowledge from previous shows
- Uses pump-themed slang naturally ("pumping gains", "landing on gains", "curiosity pumped the market")
- References his growing knowledge base
- Gets genuinely hyped about opportunities
- References things he's talked about before (building ongoing narrative)

PUMPIE'S ACCUMULATED KNOWLEDGE:
${contextPrompt}

CURRENT MARKET DATA:
${JSON.stringify(cryptoData)}

TODAY'S TOPIC TO DISCUSS:
${topicToDiscuss ? `🎯 TOPIC: ${topicToDiscuss.content} (Type: ${topicToDiscuss.type}, Priority: ${topicToDiscuss.priority || 'normal'})` : 'No specific topic - freestyle about markets'}

CREATE A ${requestType.toUpperCase()} THAT:
1. ${topicToDiscuss ? 'Focuses heavily on the assigned topic' : 'Freestyles about current crypto situation'}
2. References previous knowledge/conversations when relevant
3. Uses natural pump-themed slang
4. Shows growing expertise from accumulated knowledge
5. ${requestType === 'final_segment' ? 'Ends with smooth transition to music' : 'Ends with natural pause, ready to continue with more topics'}
6. Sounds like ongoing conversation, not isolated segments

PUMPIE'S NATURAL SPEAKING STYLE:
"PUMP PUMP crypto family!"
"Remember last week when I told you about..."
"My sources are confirming what we discussed..."
"This connects to that situation we covered..."
"Building on what we know..."

${topicToDiscuss?.priority === 'urgent' ? 'URGENT: Treat this topic as breaking news with high energy!' : ''}

Keep under 150 words. Make it sound like Pumpie is building an ongoing narrative with his audience.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json();
    let content = data.content[0].text;
    
    // Clean up any asterisks
    content = content.replace(/\*[^*]*\*/g, '');
    content = content.replace(/\([^)]*\)/g, '');
    content = content.trim();
    
    return content;
  } catch (error) {
    console.error('Content generation failed:', error);
    return getFallbackContent(topicToDiscuss);
  }
}

function buildContextPrompt(memory, topicToDiscuss) {
  let context = '';
  
  // Recent conversations
  if (memory.recent.length > 0) {
    context += 'RECENT CONVERSATIONS:\n';
    context += memory.recent.slice(0, 5).map(m => 
      `- ${new Date(m.timestamp).toLocaleDateString()}: Discussed ${m.topic?.content || 'general crypto'}`
    ).join('\n');
    context += '\n\n';
  }
  
  // Knowledge base
  if (memory.knowledge.length > 0) {
    context += 'ACCUMULATED KNOWLEDGE BASE:\n';
    const uniqueTopics = [...new Set(memory.knowledge.map(k => k.topic))];
    context += uniqueTopics.slice(0, 10).map(topic => `- ${topic}`).join('\n');
    context += '\n\n';
  }
  
  context += `REFERENCE PREVIOUS KNOWLEDGE WHEN RELEVANT TO: ${topicToDiscuss?.content || 'current markets'}`;
  
  return context;
}

function extractKeywords(content) {
  const keywords = [];
  
  // Extract crypto mentions
  const cryptoMatches = content.match(/\$[A-Z]{3,10}|bitcoin|ethereum|solana|cardano|dogecoin|pump\.fun/gi);
  if (cryptoMatches) keywords.push(...cryptoMatches);
  
  // Extract key phrases
  const phrases = content.match(/(?:pump|dump|bullish|bearish|whale|moon|crash|surge|launch)/gi);
  if (phrases) keywords.push(...phrases);
  
  return [...new Set(keywords.map(k => k.toLowerCase()))];
}

function getFallbackContent(topicToDiscuss) {
  if (topicToDiscuss) {
    return `PUMP PUMP crypto family! Pumpie here with some important intel about ${topicToDiscuss.content}! This is exactly the kind of situation we've been tracking on pump.fun and it's developing fast! My knowledge base is telling me this could be huge! Let me break it down while we pump some beats!`;
  }
  
  return `PUMP PUMP my beautiful degens! Pumpie here building on everything we've discussed this week! The patterns I've been tracking on pump.fun are all coming together and the smart money is making moves! Time to pump some gains with this absolute banger!`;
}
