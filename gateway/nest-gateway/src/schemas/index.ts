import { z } from 'zod';
import { LANGUAGES, DIFFICULTIES, ROLE_ADMIN, ROLE_TEACHER, ROLE_USER } from '../constants';

export const SubmitSchema = z.object({
  problem_id: z.number().int().positive(),
  language: z.enum(LANGUAGES),
  source_code: z.string().min(1).max(50000),
  stdin: z.string().max(10000).optional()
});

export const CreateProblemSchema = z.object({
  title: z.string().min(1).max(255),
  difficulty: z.enum(DIFFICULTIES),
  description: z.string().min(1).max(10000),
  tags: z.array(z.string().min(1).max(30)).max(10).optional()
});

export const UpdateProblemSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  description: z.string().min(1).max(10000).optional(),
  tags: z.array(z.string().min(1).max(30)).max(10).optional()
});

export const CreateTestCaseSchema = z.object({
  input_data: z.string().min(1).max(10000),
  expected_output: z.string().min(1).max(10000),
  is_sample: z.boolean().optional()
});

export const UpdateTestCaseSchema = z.object({
  input_data: z.string().min(1).max(10000).optional(),
  expected_output: z.string().min(1).max(10000).optional(),
  is_sample: z.boolean().optional()
});

export const BulkTestCaseSchema = z.object({
  items: z.array(
    z.object({
      input_data: z.string().min(1).max(10000),
      expected_output: z.string().min(1).max(10000),
      is_sample: z.boolean().optional()
    })
  ).min(1).max(100)
});

export const RegisterSchema = z.object({
  email: z.string().email().max(255),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/, 'username must contain only letters, digits, underscores, or hyphens'),
  password: z.string().min(6).max(100)
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const BulkProblemSchema = z.object({
  items: z.array(
    z.object({
      title: z.string().min(1).max(255),
      difficulty: z.enum(DIFFICULTIES),
      description: z.string().min(1).max(10000),
      tags: z.array(z.string().min(1).max(30)).max(10).optional(),
      test_cases: z.array(
        z.object({
          input_data: z.string().min(1).max(10000),
          expected_output: z.string().min(1).max(10000),
          is_sample: z.boolean().optional()
        })
      ).min(1).max(100)
    })
  ).min(1).max(50)
});

export const UpdateUserSchema = z.object({
  role: z.enum([ROLE_ADMIN, ROLE_TEACHER, ROLE_USER]).optional(),
  banned: z.boolean().optional(),
  // 封号透明化：管理员可记录封禁原因与解封时间，二者仅在 banned=true 时生效
  ban_reason: z.string().min(1).max(500).optional(),
  // ISO 8601 字符串；null 表示永久封禁。仅在 banned=true 时生效
  banned_until: z.union([z.string().datetime(), z.null()]).optional()
});

export const CreateAnnouncementSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().min(1).max(10000),
  is_active: z.boolean().optional(),
  pinned: z.boolean().optional(),
  category: z.string().min(1).max(32).optional(),
  expires_at: z.union([z.string().datetime(), z.null()]).optional()
});

export const UpdateAnnouncementSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  content: z.string().min(1).max(10000).optional(),
  is_active: z.boolean().optional(),
  pinned: z.boolean().optional(),
  category: z.string().min(1).max(32).optional(),
  expires_at: z.union([z.string().datetime(), z.null()]).optional()
});

export const SetDailyProblemSchema = z.object({
  problem_id: z.number().int().positive()
});

export const UpdateProfileSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_\u4e00-\u9fa5]{3,50}$/, 'username must be 3-50 chars of letters, digits, underscore or Chinese').optional()
});

export const ChangePasswordSchema = z.object({
  old_password: z.string().min(1).max(100),
  new_password: z.string().min(6).max(100)
});

export const CreateSolutionSchema = z.object({
  problem_id: z.number().int().positive(),
  title: z.string().min(1).max(255),
  content: z.string().min(1).max(20000)
});

export const ReviewSolutionSchema = z.object({
  status: z.enum(['approved', 'rejected'])
});

export const CreateContestSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(10000).optional().default(''),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  problem_ids: z.array(z.number().int().positive()).min(1).max(50)
});

export const UpdateContestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(10000).optional(),
  start_time: z.string().min(1).optional(),
  end_time: z.string().min(1).optional(),
  problem_ids: z.array(z.number().int().positive()).min(1).max(50).optional()
});

export const RunCodeSchema = z.object({
  language: z.enum(LANGUAGES),
  source_code: z.string().min(1).max(50000),
  stdin: z.string().max(10000).default('')
});

// 站内信：管理员发送通知。user_id 指定单用户；broadcast=true 群发所有用户。二者互斥。
export const SendNotificationSchema = z.object({
  user_id: z.number().int().positive().optional(),
  broadcast: z.boolean().optional(),
  type: z.enum(['system', 'announcement', 'submission', 'other']).default('system'),
  title: z.string().min(1).max(255),
  content: z.string().max(2000).default('')
}).refine((data) => (data.user_id ? !data.broadcast : true), {
  message: 'user_id 与 broadcast 互斥，群发时不要传 user_id'
});

export const CreateCommentSchema = z.object({
  content: z.string().min(1).max(2000)
});

export const CreateProfileMessageSchema = z.object({
  content: z.string().min(1).max(1000)
});

export const PROFILE_MODULE_KEYS = ['heatmap', 'solved', 'messages', 'social', 'badges'] as const;
export const PROFILE_VISIBILITIES = ['public', 'hidden', 'self'] as const;

export const UpdateProfileModulesSchema = z.object({
  modules: z.record(
    z.enum(PROFILE_MODULE_KEYS),
    z.enum(PROFILE_VISIBILITIES)
  )
});
