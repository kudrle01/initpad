import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, GraduationCap, KeyRound, LockKeyhole, Plus, Users } from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { useToast } from '@/toast';
import { PageHeader } from '@/components/molecules/PageHeader';
import { EmptyState } from '@/components/molecules/EmptyState';
import { CreateCourseDialog } from '@/components/organisms/CreateCourseDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { CourseSummary } from '@/types';

export default function Courses() {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const { user, refreshWorkspaces } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const load = useCallback(() => {
    api.listCourses().then(setCourses).catch((error) => toast.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => load(), [load]);

  async function join() {
    if (!code.trim() || joining) return;
    setJoining(true);
    try {
      const course = await api.joinCourse(code.trim());
      toast.success(`Joined ${course.name}`);
      navigate(`/courses/${course.id}`);
    } catch (error) {
      toast.error((error as Error).message);
      setJoining(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Courses"
        subtitle="Teaching spaces connect student teams to isolated workspaces without exposing school infrastructure credentials."
        actions={user?.platformRole === 'admin' ? (
          <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Create course</Button>
        ) : undefined}
      />

      <Card className="mb-6 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-4 w-4 text-primary" /> Join a course
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Enter the one-time code shared by your instructor. It never grants access to another team’s projects.
            </p>
            <Input className="mt-3 max-w-sm font-mono" aria-label="Course enrollment code"
              placeholder="INIT-XXXX-XXXX-XXXX-XXXX" spellCheck={false} value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())} />
          </div>
          <Button onClick={join} disabled={!code.trim() || joining}>{joining ? 'Joining…' : 'Join course'}</Button>
        </div>
      </Card>

      {loading ? <p className="text-sm text-muted-foreground">Loading courses…</p> : courses.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No courses yet"
          description={user?.platformRole === 'admin'
            ? 'Create the first course, or join one with an enrollment code.'
            : 'Ask your instructor for an enrollment code.'} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {courses.map((course) => (
            <Card key={course.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[15px] font-semibold">{course.name}</h2>
                  <p className="font-mono text-xs text-muted-foreground">{course.slug}</p>
                </div>
                <Badge>{course.role}</Badge>
              </div>
              {course.description && <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{course.description}</p>}
              <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {course.memberCount} members</span>
                <span>{course.teamCount} teams</span>
                {course.membershipLocked && <span className="flex items-center gap-1 text-warning"><LockKeyhole className="h-3.5 w-3.5" /> locked</span>}
              </div>
              <Button asChild variant="secondary" className="mt-5 self-start">
                <Link to={`/courses/${course.id}`}>Open course <ArrowRight className="h-4 w-4" /></Link>
              </Button>
            </Card>
          ))}
        </div>
      )}

      <CreateCourseDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => {
        load();
        void refreshWorkspaces();
      }} />
    </div>
  );
}
