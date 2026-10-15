import { createFileRoute } from '@tanstack/react-router';
import { SignupPage } from '@/components/auth/pages';

export const Route = createFileRoute('/signup')({
  head: () => ({
    meta: [
      { title: 'Create Account — CrowdGuard AI' },
      {
        name: 'description',
        content: 'Create a secure CrowdGuard AI operator account.'
      }
    ]
  }),
  component: SignupPage
});