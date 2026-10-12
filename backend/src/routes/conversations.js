import express from 'express';
import { getConversation, listConversations, listMessages } from '../services/store/index.js';

const router = express.Router();

function publicConversation(conversation) {
  const visible = { ...conversation };
  delete visible.phone_hash;
  return visible;
}

router.get('/', async (req, res, next) => {
  try {
    const conversations = await listConversations();
    return res.json({ conversations: conversations.map(publicConversation) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const conversation = await getConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    return res.json({ conversation: publicConversation(conversation), messages: await listMessages(conversation.id) });
  } catch (error) {
    return next(error);
  }
});

export default router;
