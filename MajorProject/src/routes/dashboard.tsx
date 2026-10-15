import { createFileRoute } from '@tanstack/react-router';
import { Dashboard } from '@/components/command/dashboard';

export const Route = createFileRoute('/dashboard')({ component: Dashboard });
