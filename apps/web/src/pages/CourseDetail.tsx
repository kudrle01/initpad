import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, Check, KeyRound, LockKeyhole, LogOut, Plus, RotateCw, Settings2, Trash2, Users,
} from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { useToast } from '@/toast';
import { Spinner } from '@/components/atoms/Spinner';
import { CopyField } from '@/components/molecules/CopyField';
import { PageHeader } from '@/components/molecules/PageHeader';
import { CreateCourseTeamDialog } from '@/components/organisms/CreateCourseTeamDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { CourseDetail as CourseDetailType, CourseMember } from '@/types';

export default function CourseDetail() {
  const { id = '' } = useParams();
  const [course, setCourse] = useState<CourseDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [identity, setIdentity] = useState('');
  const [memberRole, setMemberRole] = useState<'student' | 'instructor'>('student');
  const { user, refreshWorkspaces, switchWorkspace } = useAuth();
  const toast = useToast();

  const load = useCallback(() => {
    api.getCourse(id).then(setCourse).catch((error) => toast.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [id, toast]);
  useEffect(() => load(), [load]);

  const me = useMemo(() => course
    ? [...course.instructors, ...course.students].find((member) => member.userId === user?.id)
    : undefined, [course, user?.id]);
  const myTeam = course?.teams.find((team) => team.id === me?.teamId);
  const instructor = course?.role === 'instructor';

  async function updatePolicy(field: 'enrollmentOpen' | 'membershipLocked', value: boolean) {
    if (!course) return;
    setBusy(true);
    try {
      setCourse(await api.updateCourse(course.id, { [field]: value }));
      toast.success(field === 'membershipLocked' ? (value ? 'Membership locked' : 'Membership unlocked') : (value ? 'Enrollment opened' : 'Enrollment closed'));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rotateCode() {
    if (!course || !window.confirm('Rotate the enrollment code? The previous code will stop working immediately.')) return;
    setBusy(true);
    try {
      const result = await api.rotateCourseEnrollmentCode(course.id);
      setNewCode(result.enrollmentCode);
      toast.success('Enrollment code rotated');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addMember() {
    if (!course || !identity.trim()) return;
    setBusy(true);
    try {
      setCourse(await api.addCourseMember(course.id, identity.trim(), memberRole));
      setIdentity('');
      toast.success('Course member added');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: CourseMember) {
    if (!course || !window.confirm(`Remove @${member.username} from ${course.name}?`)) return;
    setBusy(true);
    try {
      setCourse(await api.removeCourseMember(course.id, member.userId));
      toast.success(`Removed @${member.username}`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function joinTeam(teamId: string) {
    if (!course) return;
    setBusy(true);
    try {
      setCourse(await api.joinCourseTeam(course.id, teamId));
      await refreshWorkspaces();
      toast.success('Joined team workspace');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function leaveTeam(teamId: string, memberId = user?.id) {
    if (!course || !memberId) return;
    setBusy(true);
    try {
      setCourse(await api.removeCourseTeamMember(course.id, teamId, memberId));
      await refreshWorkspaces();
      toast.success(memberId === user?.id ? 'Left team' : 'Student removed from team');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading course…</p>;
  if (!course) return <p className="text-sm text-destructive">Course could not be loaded.</p>;

  return (
    <div>
      <Link to="/courses" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Courses
      </Link>
      <PageHeader title={course.name}
        subtitle={course.description || `${course.slug} · ${course.role}`}
        actions={<Badge>{course.role}</Badge>} />

      <div className="grid gap-6">
        {instructor && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <div className="flex items-center gap-2 text-sm font-semibold"><Settings2 className="h-4 w-4 text-primary" /> Enrollment policy</div>
              <p className="mt-1 text-xs text-muted-foreground">Closing enrollment rejects the code. Locking also freezes student team changes.</p>
              <div className="mt-4 grid gap-3">
                <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
                  <span><span className="block font-medium">Enrollment open</span><span className="text-xs text-muted-foreground">Students may join with the current code</span></span>
                  <input type="checkbox" checked={course.enrollmentOpen} disabled={busy}
                    onChange={(event) => updatePolicy('enrollmentOpen', event.target.checked)} />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
                  <span><span className="flex items-center gap-1 font-medium"><LockKeyhole className="h-3.5 w-3.5" /> Membership locked</span><span className="text-xs text-muted-foreground">Students cannot join, create, join or leave teams</span></span>
                  <input type="checkbox" checked={course.membershipLocked} disabled={busy}
                    onChange={(event) => updatePolicy('membershipLocked', event.target.checked)} />
                </label>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4 text-primary" /> Enrollment code</div>
              <p className="mt-1 text-xs text-muted-foreground">Codes are stored as hashes and shown only immediately after creation or rotation.</p>
              {newCode ? <div className="mt-4"><CopyField command={newCode} /></div> : (
                <Button className="mt-4" variant="secondary" disabled={busy} onClick={rotateCode}>
                  <RotateCw className="h-4 w-4" /> Rotate and reveal new code
                </Button>
              )}
            </Card>
          </div>
        )}

        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4 text-primary" /> Student teams</div>
              <p className="mt-1 text-xs text-muted-foreground">Each team is a separate project authorization boundary.</p>
            </div>
            {(instructor || (!me?.teamId && !course.membershipLocked)) && (
              <Button size="sm" onClick={() => setTeamDialogOpen(true)}><Plus className="h-4 w-4" /> Create team</Button>
            )}
          </div>

          {course.teams.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No teams yet.</p> : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {course.teams.map((team) => {
                const mine = team.id === me?.teamId;
                return (
                  <div key={team.id} className="rounded-md border border-border p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div><h3 className="text-sm font-semibold">{team.name}</h3><p className="text-xs text-muted-foreground">{team.members.length} students</p></div>
                      {mine && <Badge><Check className="h-3 w-3" /> your team</Badge>}
                    </div>
                    <div className="mt-3 flex flex-col gap-1.5">
                      {team.members.map((member) => (
                        <div key={member.userId} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate">{member.name || `@${member.username}`}</span>
                          {instructor && (
                            <Button variant="ghost" size="icon-sm" disabled={busy}
                              aria-label={`Remove ${member.username} from team`}
                              onClick={() => leaveTeam(team.id, member.userId)}><Trash2 className="h-3.5 w-3.5" /></Button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {!instructor && !me?.teamId && !course.membershipLocked && (
                        <Button size="sm" disabled={busy} onClick={() => joinTeam(team.id)}>Join team</Button>
                      )}
                      {mine && !course.membershipLocked && (
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => leaveTeam(team.id)}><LogOut className="h-3.5 w-3.5" /> Leave</Button>
                      )}
                      {(mine || instructor) && (
                        <Button size="sm" variant="secondary" onClick={() => switchWorkspace(team.workspaceId)}>Open workspace</Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4 text-primary" /> Course members</div>
          <p className="mt-1 text-xs text-muted-foreground">{course.instructors.length} instructors · {course.students.length} students</p>
          {instructor && (
            <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_140px_auto]">
              <Input placeholder="Username or e-mail" aria-label="Course member identity" value={identity}
                onChange={(event) => setIdentity(event.target.value)} />
              <Select value={memberRole} onChange={(event) => setMemberRole(event.target.value as 'student' | 'instructor')}>
                <option value="student">Student</option><option value="instructor">Instructor</option>
              </Select>
              <Button disabled={busy || !identity.trim()} onClick={addMember}><Plus className="h-4 w-4" /> Add</Button>
            </div>
          )}
          <div className="mt-4 divide-y divide-border rounded-md border border-border">
            {[...course.instructors, ...course.students].map((member) => (
              <div key={member.userId} className="flex items-center gap-3 p-3">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{member.name || `@${member.username}`}</span><span className="block text-xs text-muted-foreground">@{member.username}</span></span>
                <Badge>{member.role}</Badge>
                {instructor && member.userId !== user?.id && (
                  <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Remove ${member.username} from course`}
                    onClick={() => removeMember(member)}><Trash2 className="h-4 w-4" /></Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <CreateCourseTeamDialog courseId={course.id} open={teamDialogOpen}
        onOpenChange={setTeamDialogOpen} onCreated={async () => {
          load();
          await refreshWorkspaces();
        }} />
      {busy && <span className="sr-only"><Spinner /> Updating</span>}
    </div>
  );
}
