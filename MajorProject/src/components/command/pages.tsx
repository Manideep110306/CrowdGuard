import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus, Pencil, Trash2, Play, Camera, Save, BrainCircuit, ArrowRight, Download, FileText, Shield, Eye, EyeOff, Radio, Database, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCommand } from './store';
import { PageHeading, Panel, Badge, ZoneCards, Modal, Stats } from './shared';
import { Feed, CameraSelector, MonitoringControls } from './feed';
import { AlertTable } from './alerts';
import { monitoringApi, type BackendStatus, type Camera as CameraType, type CameraDraft } from '@/lib/monitoring-api';
import { useAuth } from '@/lib/auth';
import { AuthError } from '@/lib/auth-api';

export function LiveMonitoring() { const { cameras,selectedCamera,monitoring,telemetry,setTelemetry,notify }=useCommand(); const camera=cameras.find(c=>c.id===selectedCamera); useEffect(()=>{ if(monitoring!=='Running'||!selectedCamera){setTelemetry(null);return;} let alive=true; const poll=async()=>{try{const status=await monitoringApi.monitoring(selectedCamera);if(alive)setTelemetry(status);}catch(e){if(alive){setTelemetry(null);notify(e instanceof Error?e.message:'Monitoring data unavailable.');}}}; void poll(); const timer=setInterval(()=>void poll(),750); return()=>{alive=false;clearInterval(timer);}; },[monitoring,selectedCamera,setTelemetry,notify]); return <><PageHeading title="Live Monitoring" subtitle="Camera process status and live AI telemetry." eyebrow="REAL-TIME OPERATIONS"><CameraSelector/></PageHeading><div className="monitoring-layout"><Panel title="Camera stream" extra={<Badge tone={monitoring==='Running'?'normal':'muted'}>{monitoring==='Running'?'AI Monitoring Active':'Standby'}</Badge>}><Feed large/><div className="monitoring-controls"><MonitoringControls/></div></Panel><Panel title="Monitoring telemetry"><dl className="telemetry"><div><dt>Camera</dt><dd>{camera?.name??'No camera selected'}</dd></div><div><dt>Connection</dt><dd><Badge tone={camera?'normal':'muted'}>{camera?.status??'Unavailable'}</Badge></dd></div><div><dt>Monitoring</dt><dd>{monitoring==='Running'?'Active':'Inactive'}</dd></div><div><dt>Total people</dt><dd>{telemetry?.total_people??'--'}</dd></div></dl><p className="form-note">{monitoring==='Running'?(telemetry?'Live telemetry from Flask.':'Waiting for AI engine telemetry.'):'Start a camera process to receive telemetry.'}</p></Panel></div><Panel title="Zone status"><ZoneCards/></Panel></>; }

const emptyCamera: CameraDraft={name:'',sourceType:'Webcam',source:'0',location:''};
export function CamerasPage() {
  const navigate = useNavigate();

  const {
    cameras,
    setCameras,
    loadingCameras,
    cameraError,
    refreshCameras,
    notify,
    setSelectedCamera,
    setMonitoring,
    selectedCamera,
  } = useCommand();

  const [form, setForm] = useState<CameraDraft | null>(null);
  const [editingCamera, setEditingCamera] = useState<CameraType | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Close the form and reset editing state
  const closeForm = () => {
    setForm(null);
    setEditingCamera(null);
  };

  // Open the form to register a new camera
  const openAddForm = () => {
    setEditingCamera(null);
    setForm({ ...emptyCamera });
  };

  // Open the form with the selected camera's existing details
  const openEditForm = (camera: CameraType) => {
    setEditingCamera(camera);

    setForm({
      name: camera.name,
      sourceType: camera.sourceType,
      source: camera.source,
      location: camera.location,
    });
  };

  // Register a camera or save edits to an existing camera
  const save = async (e: FormEvent) => {
    e.preventDefault();

    if (!form || saving) return;

    const name = form.name.trim();
    const location = form.location.trim();
    const source = form.source.trim();

    if (!name) {
      notify('Enter a camera name.');
      return;
    }

    if (!location) {
      notify('Enter the camera location.');
      return;
    }

    if (form.sourceType === 'Webcam' && !/^\d+$/.test(source)) {
      notify('Enter a webcam device index such as 0.');
      return;
    }

    if (!source) {
      notify('Enter a camera source.');
      return;
    }

    if (
      form.sourceType === 'CCTV / RTSP' &&
      !/^rtsps?:\/\//i.test(source)
    ) {
      notify('Enter a valid RTSP URL.');
      return;
    }

    setSaving(true);

    try {
      const cameraDraft: CameraDraft = {
        ...form,
        name,
        location,
        source,
      };

      const savedCamera = editingCamera
        ? await monitoringApi.updateCamera(editingCamera.id, cameraDraft)
        : await monitoringApi.createCamera(cameraDraft);

      const wasEditing = editingCamera !== null;

      closeForm();

      await refreshCameras();

      setSelectedCamera(savedCamera.id);

      notify(
        wasEditing
          ? 'Camera updated successfully.'
          : 'Camera registered successfully.'
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : 'Unable to save camera.'
      );
    } finally {
      setSaving(false);
    }
  };

  // Delete a camera after confirmation
  const removeCamera = async (camera: CameraType) => {
    if (deletingId) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete "${camera.name}"? This action cannot be undone.`
    );

    if (!confirmed) return;

    setDeletingId(camera.id);

    try {
      await monitoringApi.deleteCamera(camera.id);

      // Clear the current selection if this camera was selected
      if (selectedCamera === camera.id) {
        setSelectedCamera('');
        setMonitoring('Stopped');
      }

      // Refresh the list from MongoDB
      await refreshCameras();

      notify('Camera deleted successfully.');
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : 'Unable to delete camera.'
      );
    } finally {
      setDeletingId(null);
    }
  };

  // Start camera monitoring
  const start = async (camera: CameraType) => {
    try {
      await monitoringApi.start(camera.id);

      setCameras((previous) =>
        previous.map((item) =>
          item.id === camera.id
            ? { ...item, status: 'Online' }
            : item
        )
      );

      setSelectedCamera(camera.id);
      setMonitoring('Running');

      await refreshCameras();

      notify('Monitoring active.');

      void navigate({ to: '/live-monitoring' });
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : 'Unable to start monitoring.'
      );
    }
  };

  return (
    <>
      <PageHeading
        title="Camera Management"
        subtitle="Register and monitor camera sources through the Flask service."
        eyebrow="CAMERA NETWORK"
      >
        <Button onClick={openAddForm}>
          <Plus />
          Add Camera
        </Button>

        <Button
          variant="outline"
          onClick={() => void refreshCameras()}
          disabled={loadingCameras}
        >
          Retry
        </Button>
      </PageHeading>

      {cameraError && (
        <div role="alert" className="form-note">
          Backend unavailable · {cameraError}
        </div>
      )}

      <div className="camera-summary">
        <Badge tone="normal">
          {cameras.filter((camera) => camera.status === 'Online').length} online
        </Badge>

        <Badge tone="muted">
          {cameras.filter((camera) => camera.status === 'Standby').length} standby
        </Badge>

        <span>{cameras.length} total cameras</span>
      </div>

      {loadingCameras ? (
        <div className="empty-state">Loading cameras…</div>
      ) : cameras.length === 0 ? (
        <div className="empty-state">
          <Camera />
          No cameras registered. Add your first webcam or CCTV camera.
        </div>
      ) : (
        <div className="camera-grid">
          {cameras.map((camera) => (
            <article className="camera-card" key={camera.id}>
              <div className="camera-thumb camera-standby">
                <Camera size={32} />

                <Badge
                  tone={camera.status === 'Online' ? 'normal' : 'muted'}
                >
                  {camera.status}
                </Badge>
              </div>

              <div className="camera-card-body">
                <span className="eyebrow">{camera.id}</span>

                <h2>{camera.name}</h2>

                <p>{camera.location}</p>

                <dl>
                  <div>
                    <dt>Source</dt>
                    <dd>{camera.sourceType}</dd>
                  </div>

                  <div>
                    <dt>Device / URL</dt>
                    <dd>{camera.source}</dd>
                  </div>
                </dl>

                <div className="camera-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditForm(camera)}
                    disabled={saving || deletingId !== null}
                  >
                    <Pencil />
                    Edit
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void removeCamera(camera)}
                    disabled={deletingId !== null || saving}
                  >
                    <Trash2 />
                    {deletingId === camera.id ? 'Deleting…' : 'Delete'}
                  </Button>

                  <Button
                    size="sm"
                    onClick={() => void start(camera)}
                    disabled={camera.status === 'Online' || deletingId !== null}
                  >
                    <Play />
                    Start
                  </Button>

                  <Button asChild variant="ghost" size="sm">
                    <Link
                      to="/live-monitoring"
                      onClick={() => setSelectedCamera(camera.id)}
                    >
                      Monitor
                    </Link>
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {form && (
        <Modal
          title={editingCamera ? 'Edit camera' : 'Add camera'}
          onClose={closeForm}
        >
          <form className="form-stack" onSubmit={(e) => void save(e)}>
            <label>
              Camera name
              <input
                required
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value })
                }
              />
            </label>

            <label>
              Source type
              <select
                value={form.sourceType}
                onChange={(e) => {
                  const sourceType = e.target.value as CameraType['sourceType'];

                  setForm({
                    ...form,
                    sourceType,
                    source: sourceType === 'Webcam' ? '0' : '',
                  });
                }}
              >
                <option>Webcam</option>
                <option>Video</option>
                <option>CCTV / RTSP</option>
              </select>
            </label>

            <label>
              Location
              <input
                required
                value={form.location}
                onChange={(e) =>
                  setForm({ ...form, location: e.target.value })
                }
              />
            </label>

            <label>
              {form.sourceType === 'Webcam'
                ? 'Webcam Device ID'
                : form.sourceType === 'Video'
                  ? 'Video file path'
                  : 'RTSP URL'}

              <input
                required
                value={form.source}
                onChange={(e) =>
                  setForm({ ...form, source: e.target.value })
                }
                placeholder={
                  form.sourceType === 'Webcam'
                    ? '0'
                    : form.sourceType === 'Video'
                      ? '/path/to/video.mp4'
                      : 'rtsp://camera/stream'
                }
              />
            </label>

            {form.sourceType === 'Webcam' && (
              <p className="form-note">
                Webcam Device ID: 0. The backend runs the Python/OpenCV camera process.
              </p>
            )}

            {editingCamera?.status === 'Online' && (
              <p className="form-note">
                This camera is running. Stop monitoring it before changing
                its source type or device/URL.
              </p>
            )}

            <div className="modal-actions">
              <Button
                type="button"
                variant="outline"
                onClick={closeForm}
                disabled={saving}
              >
                Cancel
              </Button>

              <Button type="submit" disabled={saving}>
                <Save />
                {saving
                  ? 'Saving…'
                  : editingCamera
                    ? 'Update Camera'
                    : 'Save Camera'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
const predefinedZones = [
  ['Left Zone', 'Left third of the frame', '20'],
  ['Center Zone', 'Center third of the frame', '20'],
  ['Right Zone', 'Right third of the frame', '20'],
];
export function ZonesPage(){return <><PageHeading title="Zone Configuration" subtitle="Predefined vertical zones used by the AI monitoring pipeline." eyebrow="SPATIAL INTELLIGENCE"/><p className="form-note">Cameras use these enabled vertical zones automatically when no custom zones are saved. The user-defined zone editor can be added next.</p><Panel title="Predefined vertical zones"><div className="table-scroll"><table><thead><tr><th>Zone</th><th>Frame coverage</th><th>Capacity</th><th>Warning threshold</th><th>Critical threshold</th><th>Enabled</th></tr></thead><tbody>{predefinedZones.map(([name,coverage,capacity])=><tr key={name}><td>{name}</td><td>{coverage}</td><td>{capacity}</td><td>80%</td><td>100%</td><td>Yes</td></tr>)}</tbody></table></div></Panel></>;}
export function AlertsPage(){return <><PageHeading title="Alert Management" subtitle="Safety events from the AI alert service." eyebrow="SAFETY RESPONSE"/><Panel title="Safety events"><div className="empty-state"><Shield/>Alerts will appear here when the AI alert service is connected.</div></Panel></>;}
export function AnalyticsPage(){return <><PageHeading title="Crowd Analytics" subtitle="Historical occupancy and safety intelligence." eyebrow="HISTORICAL INTELLIGENCE"/><div className="analytics-grid"><Panel title="Historical analytics"><div className="empty-state">No historical analytics available yet.</div></Panel></div></>;}
export function ReportsPage(){return <><PageHeading title="Monitoring Reports" subtitle="Operational reports from the crowd monitoring service." eyebrow="OPERATIONS REPORTING"/><Panel title="Reports"><div className="empty-state"><FileText/>Report generation service not connected yet.</div></Panel><Button variant="outline" disabled><Download/>Generate report</Button></>;}
export function SettingsPage(){const{user,logout}=useAuth();const navigate=useNavigate();return <><PageHeading title="System Settings" subtitle="Service connectivity and future configuration." eyebrow="PLATFORM CONFIGURATION"/><div className="settings-layout"><Panel title="Service status"><ServiceStatus/></Panel><Panel title="Operator profile"><div className="account-preview"><div className="avatar">{user?.name?.slice(0,1).toUpperCase()??'?'}</div><div><strong>{user?.name??'Authenticated operator'}</strong><small>{user?.email??'No email provided'} · {user?.role??'security_operator'}</small></div></div><Button variant="outline" onClick={()=>void logout().then(()=>navigate({to:'/login'}))}><LogOut/>Log out</Button></Panel><Panel title="AI Safety Assistant"><div className="empty-state"><BrainCircuit/>AI Safety Assistant will become available when the AI assistant API is connected.</div></Panel></div></>;}
function ServiceStatus(){const {health,monitoring}=useCommand();return <div className="service-list"><div><Radio/><strong>Flask backend</strong><Badge tone={health.online?'normal':'critical'}>{health.online?'Online':'Offline'}</Badge></div><div><Database/><strong>Database</strong><Badge tone="muted">Status unavailable</Badge></div><div><BrainCircuit/><strong>AI Engine</strong><Badge tone={monitoring==='Running'?'normal':'muted'}>{monitoring==='Running'?'Monitoring':'Not available'}</Badge></div></div>;}
function SettingToggle({title,caption}:{title:string;caption:string}){const[on,setOn]=useState(true);return <label className="setting-toggle"><span><strong>{title}</strong><small>{caption}</small></span><input role="switch" type="checkbox" checked={on} onChange={e=>setOn(e.target.checked)}/></label>;}
export function LoginPage(){const{login}=useAuth();const navigate=useNavigate();const[show,setShow]=useState(false);const[identifier,setIdentifier]=useState('');const[password,setPassword]=useState('');const[error,setError]=useState('');const[busy,setBusy]=useState(false);const submit=async(e:FormEvent)=>{e.preventDefault();const cleanIdentifier=identifier.trim();if(!cleanIdentifier){setError('Username or email is required.');return;}if(!password){setError('Password is required.');return;}setError('');setBusy(true);try{await login(cleanIdentifier,password);setPassword('');void navigate({to:'/dashboard',replace:true});}catch(reason){setError(reason instanceof AuthError?reason.message:'Unable to sign in. Please try again.');setPassword('');}finally{setBusy(false);}};return <div className="login-page"><div className="login-scrim"/><div className="login-brand"><div className="brand-mark"><Shield size={26}/></div><div><strong>CROWD<span>GUARD</span></strong><small>AI SAFETY PLATFORM</small></div></div><div className="login-layout"><section className="login-intro"><div className="eyebrow">AUTHORIZED ACCESS / AI OPERATIONS</div><h1>AI CROWD SAFETY</h1><p>Intelligent Crowd Monitoring &amp; Safety Alert System</p><span>Authorized access to the AI-powered crowd monitoring command center.</span><div className="login-signal"><Radio/><span><strong>COMPUTER VISION ONLINE</strong><small>Camera intelligence · Crowd safety · Secure operations</small></span></div></section><section className="login-card"><div className="login-heading"><Badge tone="muted">SECURE AUTHENTICATION</Badge><h2>Secure Login</h2><p>Sign in to access the Crowd Safety Command Center</p></div><form className="login-form" onSubmit={e=>void submit(e)} noValidate><label htmlFor="identifier">Username or Email<input id="identifier" value={identifier} onChange={e=>setIdentifier(e.target.value)} autoComplete="username" placeholder="operator@organization.com" aria-invalid={Boolean(error&& !identifier.trim())}/></label><label htmlFor="password">Password<div className="password-input"><input id="password" value={password} onChange={e=>setPassword(e.target.value)} type={show?'text':'password'} autoComplete="current-password" placeholder="Enter your password" aria-invalid={Boolean(error&& !password)}/><Button variant="ghost" size="icon" type="button" aria-label={show?'Hide password':'Show password'} onClick={()=>setShow(v=>!v)}>{show?<EyeOff/>:<Eye/>}</Button></div></label>{error&&<div role="alert" className="form-note login-error">{error}</div>}<Button size="lg" type="submit" disabled={busy}>{busy?'Signing in...':'Secure Login'}<ArrowRight/></Button><p className="login-notice"><Shield size={14}/> Authorized personnel only. All monitoring access is logged by the system.</p></form></section></div></div>;}
