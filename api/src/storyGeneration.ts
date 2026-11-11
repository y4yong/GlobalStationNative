import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import { config } from './config.js';

const storyIdeaSchema = z.object({
  title: z.string().trim().min(2).max(160),
  summary: z.string().trim().min(20).max(3000),
});

export async function generateStoryIdea(prompt: string) {
  const region = config.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (!region || !config.BEDROCK_STORY_MODEL_ID) {
    throw Object.assign(
      new Error('AI story generation is not configured. Set AWS_REGION and BEDROCK_STORY_MODEL_ID for the API.'),
      { statusCode: 503 },
    );
  }

  const client = new BedrockRuntimeClient({ region });
  try {
    const response = await client.send(new ConverseCommand({
      modelId: config.BEDROCK_STORY_MODEL_ID,
      system: [{
        text: 'Create original story concepts rooted in Malaysian voices and culture. Do not copy existing films, books, characters, or franchises. Return only valid JSON with string fields "title" and "summary".',
      }],
      messages: [{
        role: 'user',
        content: [{ text: `Create one original short serialized drama concept from this creator brief: ${prompt}` }],
      }],
      inferenceConfig: { maxTokens: 700, temperature: 0.8 },
    }));

    const text = response.output?.message?.content
      ?.map((block) => ('text' in block ? block.text : ''))
      .join('')
      .trim();
    if (!text) {
      throw Object.assign(new Error('The story generator returned no usable text.'), { statusCode: 502 });
    }

    const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw Object.assign(new Error('The story generator returned an invalid response. Please try again.'), { statusCode: 502 });
    }
    return storyIdeaSchema.parse(parsed);
  } catch (error) {
    if (error instanceof Error && 'statusCode' in error) throw error;
    console.error('Bedrock story generation failed.', error);
    throw Object.assign(new Error('AI story generation is temporarily unavailable.'), { statusCode: 502 });
  } finally {
    client.destroy();
  }
}
