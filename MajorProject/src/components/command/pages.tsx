import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus, Pencil, Trash2, Play, Camera, Save, BrainCircuit, ArrowRight, Download, FileText, Shield, Eye, EyeOff, Radio, Database, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCommand } from './store';
import { PageHeading, Panel, Badge, ZoneCards, Modal, Stats } from './shared';
import { Feed, CameraSelector, MonitoringControls } from './feed';
import { AlertTable } from './alerts';
import {
  monitoringApi,
  type BackendStatus,
  type Camera as CameraType,
  type CameraDraft,
  type CameraZoneConfig,
  type ZonePoint,
} from '@/lib/monitoring-api';
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
// ============================================================
// USER-DEFINED CAMERA ZONE EDITOR
// ============================================================

const emptyZoneForm = {
  name: '',
  capacity: '20',
  warning: '80',
  critical: '100',
  enabled: true,
};

const zoneColors = [
  '#31c48d',
  '#60a5fa',
  '#f59e0b',
  '#c084fc',
  '#fb7185',
  '#22d3ee',
];

type PreviewKind = 'webcam' | 'image' | null;

export function ZonesPage() {
  const {
    cameras,
    selectedCamera,
    setSelectedCamera,
    notify,
  } = useCommand();

  const [cameraId, setCameraId] = useState(selectedCamera || '');

  const [zones, setZones] = useState<CameraZoneConfig[]>([]);
  const [loadingZones, setLoadingZones] = useState(false);
  const [savingZones, setSavingZones] = useState(false);
  const [zoneError, setZoneError] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftPoints, setDraftPoints] = useState<ZonePoint[]>([]);
  const [form, setForm] = useState({ ...emptyZoneForm });

  const [previewKind, setPreviewKind] = useState<PreviewKind>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const [previewSize, setPreviewSize] = useState({
    width: 4,
    height: 3,
  });

  const [previewError, setPreviewError] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imageUrlRef = useRef<string | null>(null);

  const selectedCameraInfo = cameras.find(
    (camera) => camera.id === cameraId,
  );

  // ----------------------------------------------------------
  // Keep the editor aligned with the selected camera
  // ----------------------------------------------------------

  useEffect(() => {
    const selectedCameraExists = cameras.some(
      (camera) => camera.id === selectedCamera,
    );

    if (
      selectedCameraExists &&
      selectedCamera !== cameraId
    ) {
      setCameraId(selectedCamera);
      return;
    }

    const currentCameraExists = cameras.some(
      (camera) => camera.id === cameraId,
    );

    if (!currentCameraExists) {
      const firstCameraId = cameras[0]?.id ?? '';

      if (firstCameraId !== cameraId) {
        setCameraId(firstCameraId);

        if (firstCameraId) {
          setSelectedCamera(firstCameraId);
        }
      }
    }
  }, [
    cameras,
    cameraId,
    selectedCamera,
    setSelectedCamera,
  ]);

  // ----------------------------------------------------------
  // Stop the browser camera preview
  // ----------------------------------------------------------

  const releaseWebcam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(
        (track) => track.stop(),
      );

      streamRef.current = null;
    }
  };

  // ----------------------------------------------------------
  // Load saved zones whenever the camera changes
  // ----------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    setZones([]);
    setDraftPoints([]);
    setEditingId(null);
    setForm({ ...emptyZoneForm });
    setZoneError('');
    setPreviewError('');

    releaseWebcam();

    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = null;
    }

    setPreviewImageUrl(null);
    setPreviewKind(null);

    if (!cameraId) {
      setLoadingZones(false);

      return () => {
        cancelled = true;
      };
    }

    setLoadingZones(true);

    monitoringApi
      .zones(cameraId)
      .then((savedZones) => {
        if (!cancelled) {
          setZones(savedZones);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setZoneError(
            error instanceof Error
              ? error.message
              : 'Unable to load camera zones.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingZones(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cameraId]);

  // ----------------------------------------------------------
  // Connect the camera stream to the video preview
  // ----------------------------------------------------------

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;

    if (
      previewKind !== 'webcam' ||
      !video ||
      !stream
    ) {
      return;
    }

    video.srcObject = stream;

    void video.play().catch(() => {
      setPreviewError(
        'The browser could not play the webcam preview.',
      );
    });
  }, [previewKind]);

  // ----------------------------------------------------------
  // Cleanup on unmount
  // ----------------------------------------------------------

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(
        (track) => track.stop(),
      );

      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
      }
    };
  }, []);

  // ----------------------------------------------------------
  // Start browser webcam preview
  // ----------------------------------------------------------

  const startWebcamPreview = async () => {
    try {
      setPreviewError('');

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Browser camera access is unavailable. Use localhost and enable camera permissions.',
        );
      }

      releaseWebcam();

      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = null;
      }

      setPreviewImageUrl(null);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      setPreviewSize({
        width: 4,
        height: 3,
      });

      setPreviewKind('webcam');
    } catch (error) {
      setPreviewError(
        error instanceof Error
          ? error.message
          : 'Unable to open the webcam preview.',
      );
    }
  };

  // ----------------------------------------------------------
  // Stop the browser preview
  // ----------------------------------------------------------

  const stopPreview = () => {
    releaseWebcam();

    setPreviewKind(null);
    setPreviewError('');
  };

  // ----------------------------------------------------------
  // Load a reference image for video or CCTV cameras
  // ----------------------------------------------------------

  const handleReferenceImage = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setPreviewError(
        'Please select an image file.',
      );

      event.target.value = '';
      return;
    }

    releaseWebcam();

    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current);
    }

    const imageUrl = URL.createObjectURL(file);

    imageUrlRef.current = imageUrl;

    setPreviewError('');
    setPreviewImageUrl(imageUrl);
    setPreviewKind('image');

    event.target.value = '';
  };

  // ----------------------------------------------------------
  // Add a boundary point when the user clicks the preview
  // ----------------------------------------------------------

  const handleStageClick = (
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    if (!previewKind) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const x = Math.min(
      1,
      Math.max(
        0,
        (event.clientX - rect.left) / rect.width,
      ),
    );

    const y = Math.min(
      1,
      Math.max(
        0,
        (event.clientY - rect.top) / rect.height,
      ),
    );

    setDraftPoints((previous) => [
      ...previous,
      {
        x: Number(x.toFixed(6)),
        y: Number(y.toFixed(6)),
      },
    ]);
  };

  // ----------------------------------------------------------
  // Prepare a fresh zone
  // ----------------------------------------------------------

  const beginNewZone = () => {
    setEditingId(null);
    setDraftPoints([]);
    setForm({ ...emptyZoneForm });
    setZoneError('');
  };

  // ----------------------------------------------------------
  // Load an existing zone for editing
  // ----------------------------------------------------------

  const editZone = (zone: CameraZoneConfig) => {
    setEditingId(zone.id);

    setDraftPoints(
      zone.points.map((point) => ({
        x: point.x,
        y: point.y,
      })),
    );

    setForm({
      name: zone.name,
      capacity: String(zone.capacity),
      warning: String(zone.warning_threshold),
      critical: String(zone.critical_threshold),
      enabled: zone.enabled,
    });

    setZoneError('');
  };

  // ----------------------------------------------------------
  // Add the drawn zone to the pending configuration
  // ----------------------------------------------------------

  const addZoneToList = (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (!cameraId) {
      notify('Select a camera first.');
      return;
    }

    if (draftPoints.length < 3) {
      notify(
        'Draw a polygon by clicking at least three points on the preview.',
      );
      return;
    }

    const name = form.name.trim();
    const capacity = Number(form.capacity);
    const warning = Number(form.warning);
    const critical = Number(form.critical);

    if (!name) {
      notify('Enter a zone name.');
      return;
    }

    if (
      zones.some(
        (zone) =>
          zone.id !== editingId &&
          zone.name.trim().toLowerCase() === name.toLowerCase(),
      )
    ) {
      notify('A zone with this name already exists.');
      return;
    }

    if (
      !Number.isInteger(capacity) ||
      capacity <= 0
    ) {
      notify('Capacity must be a positive whole number.');
      return;
    }

    if (
      !Number.isFinite(warning) ||
      !Number.isFinite(critical) ||
      warning < 0 ||
      warning >= critical ||
      critical > 100
    ) {
      notify(
        'Set thresholds between 0 and 100, with warning below critical.',
      );
      return;
    }

    const zone: CameraZoneConfig = {
      id:
        editingId ??
        `zone-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      points: [...draftPoints],
      capacity,
      warning_threshold: warning,
      critical_threshold: critical,
      enabled: form.enabled,
    };

    setZones((previous) => {
      if (editingId) {
        return previous.map((item) =>
          item.id === editingId ? zone : item,
        );
      }

      return [...previous, zone];
    });

    setEditingId(null);
    setDraftPoints([]);
    setForm({ ...emptyZoneForm });

    notify(
      'Zone added to the pending configuration. Click Save All Zones to persist it.',
    );
  };

  // ----------------------------------------------------------
  // Delete a zone from the pending configuration
  // ----------------------------------------------------------

  const deleteZone = (zone: CameraZoneConfig) => {
    const confirmed = window.confirm(
      `Remove "${zone.name}" from this configuration? Remember to save your changes.`,
    );

    if (!confirmed) {
      return;
    }

    setZones((previous) =>
      previous.filter((item) => item.id !== zone.id),
    );

    if (editingId === zone.id) {
      setEditingId(null);
      setDraftPoints([]);
      setForm({ ...emptyZoneForm });
    }

    notify(
      'Zone removed from the pending configuration. Click Save All Zones to persist the change.',
    );
  };

  // ----------------------------------------------------------
  // Persist all zones to MongoDB through Flask
  // ----------------------------------------------------------

  const saveAllZones = async () => {
    if (!cameraId || savingZones) {
      return;
    }

    if (
      selectedCameraInfo?.status === 'Online'
    ) {
      notify(
        'Stop monitoring this camera before saving zone changes.',
      );

      return;
    }

    if (editingId) {
      notify(
        'Finish updating the selected zone before saving all zones.',
      );

      return;
    }

    setSavingZones(true);
    setZoneError('');

    try {
      const savedZones = await monitoringApi.saveZones(
        cameraId,
        zones,
      );

      setZones(savedZones);

      notify(
        'Camera zone configuration saved successfully.',
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to save camera zones.';

      setZoneError(message);
      notify(message);
    } finally {
      setSavingZones(false);
    }
  };

  const displayZones = zones.filter(
    (zone) => zone.id !== editingId,
  );

  const selectedZone = zones.find(
    (zone) => zone.id === editingId,
  );

  return (
    <>
      <PageHeading
        title="Zone Configuration"
        subtitle="Draw monitoring areas and configure individual crowd-safety thresholds."
        eyebrow="SPATIAL INTELLIGENCE"
      >
        <Button
          variant="outline"
          onClick={beginNewZone}
          disabled={!cameraId || savingZones}
        >
          <Plus />
          New Zone
        </Button>

        <Button
          onClick={() => void saveAllZones()}
          disabled={
            !cameraId ||
            loadingZones ||
            savingZones ||
            selectedCameraInfo?.status === 'Online' ||
            editingId !== null
          }
        >
          <Save />
          {savingZones ? 'Saving Zones…' : 'Save All Zones'}
        </Button>
      </PageHeading>

      {cameras.length === 0 ? (
        <Panel title="Camera required">
          <div className="empty-state">
            <Camera />
            Register a webcam or CCTV camera before configuring monitoring zones.
          </div>
        </Panel>
      ) : (
        <>
          <Panel title="Select camera">
            <div className="form-stack">
              <label>
                Camera
                <select
                  value={cameraId}
                  onChange={(event) => {
                    const nextCameraId = event.target.value;

                    setCameraId(nextCameraId);

                    if (nextCameraId) {
                      setSelectedCamera(nextCameraId);
                    }
                  }}
                >
                  {cameras.map((camera) => (
                    <option
                      key={camera.id}
                      value={camera.id}
                    >
                      {camera.name} — {camera.location}
                    </option>
                  ))}
                </select>
              </label>

              <p className="form-note">
                Every camera has its own zone configuration. Stop monitoring
                the selected camera before saving zone changes.
              </p>
            </div>
          </Panel>

          {zoneError && (
            <div role="alert" className="form-note">
              {zoneError}
            </div>
          )}

          {selectedCameraInfo?.status === 'Online' && (
            <div role="alert" className="form-note">
              This camera is currently online. Stop monitoring it before
              saving changes to its zones.
            </div>
          )}

          <Panel title="Camera reference view">
            <div className="form-stack">
              <p className="form-note">
                Click at least three points on the image to outline a polygon.
                The last point connects back to the first when the zone is saved.
              </p>

              {selectedCameraInfo?.sourceType === 'Webcam' && (
                <div className="modal-actions">
                  <Button
                    type="button"
                    onClick={() => void startWebcamPreview()}
                    disabled={previewKind === 'webcam'}
                  >
                    <Camera />
                    Start Webcam Preview
                  </Button>

                  {previewKind === 'webcam' && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={stopPreview}
                    >
                      Stop Preview
                    </Button>
                  )}
                </div>
              )}

              <label>
                Upload reference image
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleReferenceImage}
                />
              </label>

              <p className="form-note">
                For video files and CCTV/RTSP sources, upload a representative
                screenshot. For webcam configuration, you can use the browser
                preview or an image from the same camera. Ensure the reference
                view matches the actual camera angle.
              </p>

              {previewError && (
                <div role="alert" className="form-note">
                  {previewError}
                </div>
              )}

              {previewKind ? (
                <div
                  className="zone-drawing-stage"
                  onClick={handleStageClick}
                  style={{
                    position: 'relative',
                    width: '100%',
                    aspectRatio: `${previewSize.width} / ${previewSize.height}`,
                    overflow: 'hidden',
                    cursor: 'crosshair',
                    background: '#111827',
                    borderRadius: '10px',
                    border: '1px solid #475569',
                    touchAction: 'manipulation',
                  }}
                >
                  {previewKind === 'webcam' && (
                    <video
                      ref={videoRef}
                      autoPlay
                      muted
                      playsInline
                      onLoadedMetadata={(event) => {
                        const video = event.currentTarget;

                        if (
                          video.videoWidth > 0 &&
                          video.videoHeight > 0
                        ) {
                          setPreviewSize({
                            width: video.videoWidth,
                            height: video.videoHeight,
                          });
                        }
                      }}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'fill',
                      }}
                    />
                  )}

                  {previewKind === 'image' &&
                    previewImageUrl && (
                      <img
                        src={previewImageUrl}
                        alt="Camera reference for drawing monitoring zones"
                        draggable={false}
                        onLoad={(event) => {
                          const image = event.currentTarget;

                          setPreviewSize({
                            width: image.naturalWidth,
                            height: image.naturalHeight,
                          });
                        }}
                        style={{
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'fill',
                        }}
                      />
                    )}

                  <svg
                    viewBox="0 0 1000 1000"
                    preserveAspectRatio="none"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                    }}
                  >
                    {displayZones.map((zone) => {
                      const index = zones.findIndex(
                        (item) => item.id === zone.id,
                      );

                      const points = zone.points
                        .map(
                          (point) =>
                            `${point.x * 1000},${point.y * 1000}`,
                        )
                        .join(' ');

                      const color =
                        zoneColors[index % zoneColors.length];

                      const labelX =
                        zone.points.reduce(
                          (sum, point) => sum + point.x,
                          0,
                        ) /
                        zone.points.length *
                        1000;

                      const labelY =
                        zone.points.reduce(
                          (sum, point) => sum + point.y,
                          0,
                        ) /
                        zone.points.length *
                        1000;

                      return (
                        <g key={zone.id}>
                          <polygon
                            points={points}
                            fill={color}
                            fillOpacity={0.16}
                            stroke={color}
                            strokeWidth={4}
                            vectorEffect="non-scaling-stroke"
                          />

                          <text
                            x={labelX}
                            y={labelY}
                            fill="white"
                            stroke="#111827"
                            strokeWidth={1.5}
                            paintOrder="stroke"
                            fontSize={24}
                            textAnchor="middle"
                          >
                            {zone.name}
                          </text>
                        </g>
                      );
                    })}

                    {draftPoints.length > 0 && (
                      <g>
                        {draftPoints.length >= 3 ? (
                          <polygon
                            points={draftPoints
                              .map(
                                (point) =>
                                  `${point.x * 1000},${point.y * 1000}`,
                              )
                              .join(' ')}
                            fill="#facc15"
                            fillOpacity={0.18}
                            stroke="#facc15"
                            strokeWidth={4}
                            strokeDasharray="10 6"
                            vectorEffect="non-scaling-stroke"
                          />
                        ) : (
                          <polyline
                            points={draftPoints
                              .map(
                                (point) =>
                                  `${point.x * 1000},${point.y * 1000}`,
                              )
                              .join(' ')}
                            fill="none"
                            stroke="#facc15"
                            strokeWidth={4}
                            vectorEffect="non-scaling-stroke"
                          />
                        )}

                        {draftPoints.map((point, index) => (
                          <circle
                            key={`${index}-${point.x}-${point.y}`}
                            cx={point.x * 1000}
                            cy={point.y * 1000}
                            r={7}
                            fill="#facc15"
                            stroke="#111827"
                            strokeWidth={2}
                            vectorEffect="non-scaling-stroke"
                          />
                        ))}
                      </g>
                    )}
                  </svg>
                </div>
              ) : (
                <div className="empty-state">
                  <Camera />
                  Start the webcam preview or upload a reference image to draw zones.
                </div>
              )}

              {previewKind && (
                <div className="modal-actions">
                  <Badge tone="muted">
                    {draftPoints.length} boundary points
                  </Badge>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setDraftPoints((previous) => previous.slice(0, -1))
                    }
                    disabled={draftPoints.length === 0}
                  >
                    Undo Last Point
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDraftPoints([])}
                    disabled={draftPoints.length === 0}
                  >
                    Clear / Redraw
                  </Button>
                </div>
              )}

              {previewKind === 'webcam' && (
                <p className="form-note">
                  The browser preview can open your default webcam. If the
                  configured OpenCV device index refers to a different camera,
                  use a reference image from that device instead.
                </p>
              )}
            </div>
          </Panel>

          <Panel
            title={
              editingId
                ? `Edit zone: ${selectedZone?.name ?? ''}`
                : 'Configure a zone'
            }
          >
            <form
              className="form-stack"
              onSubmit={(event) => addZoneToList(event)}
            >
              <label>
                Zone name
                <input
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      name: event.target.value,
                    })
                  }
                  placeholder="e.g. Main Entrance"
                />
              </label>

              <label>
                Maximum capacity
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={form.capacity}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      capacity: event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Warning threshold (%)
                <input
                  type="number"
                  min="0"
                  max="99"
                  step="1"
                  required
                  value={form.warning}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      warning: event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Critical threshold (%)
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  required
                  value={form.critical}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      critical: event.target.value,
                    })
                  }
                />
              </label>

              <label className="setting-toggle">
                <span>
                  <strong>Zone enabled</strong>
                  <small>
                    Disabled zones are not monitored by the AI.
                  </small>
                </span>

                <input
                  type="checkbox"
                  role="switch"
                  checked={form.enabled}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      enabled: event.target.checked,
                    })
                  }
                />
              </label>

              <div className="modal-actions">
                <Button
                  type="button"
                  variant="outline"
                  onClick={beginNewZone}
                  disabled={savingZones}
                >
                  Cancel Editing
                </Button>

                <Button
                  type="submit"
                  disabled={
                    savingZones ||
                    draftPoints.length < 3 ||
                    !cameraId
                  }
                >
                  <Save />
                  {editingId ? 'Update Zone' : 'Add Zone'}
                </Button>
              </div>

              <p className="form-note">
                Adding or updating a zone changes the pending configuration.
                Click Save All Zones above to save it to the backend.
              </p>
            </form>
          </Panel>

          <Panel title={`Configured zones (${zones.length})`}>
            {loadingZones ? (
              <div className="empty-state">
                Loading saved zones…
              </div>
            ) : zones.length === 0 ? (
              <div className="empty-state">
                No zones configured. Draw your first polygon above.
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Capacity</th>
                      <th>Warning</th>
                      <th>Critical</th>
                      <th>Points</th>
                      <th>Enabled</th>
                      <th>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {zones.map((zone) => (
                      <tr key={zone.id}>
                        <td>{zone.name}</td>
                        <td>{zone.capacity}</td>
                        <td>{zone.warning_threshold}%</td>
                        <td>{zone.critical_threshold}%</td>
                        <td>{zone.points.length}</td>
                        <td>
                          {zone.enabled ? 'Yes' : 'No'}
                        </td>
                        <td>
                          <div className="camera-actions">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => editZone(zone)}
                              disabled={savingZones}
                            >
                              <Pencil />
                              Edit
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteZone(zone)}
                              disabled={savingZones}
                            >
                              <Trash2 />
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
export function AlertsPage(){return <><PageHeading title="Alert Management" subtitle="Safety events from the AI alert service." eyebrow="SAFETY RESPONSE"/><Panel title="Safety events"><div className="empty-state"><Shield/>Alerts will appear here when the AI alert service is connected.</div></Panel></>;}
export function AnalyticsPage(){return <><PageHeading title="Crowd Analytics" subtitle="Historical occupancy and safety intelligence." eyebrow="HISTORICAL INTELLIGENCE"/><div className="analytics-grid"><Panel title="Historical analytics"><div className="empty-state">No historical analytics available yet.</div></Panel></div></>;}
export function ReportsPage(){return <><PageHeading title="Monitoring Reports" subtitle="Operational reports from the crowd monitoring service." eyebrow="OPERATIONS REPORTING"/><Panel title="Reports"><div className="empty-state"><FileText/>Report generation service not connected yet.</div></Panel><Button variant="outline" disabled><Download/>Generate report</Button></>;}
export function SettingsPage(){const{user,logout}=useAuth();const navigate=useNavigate();return <><PageHeading title="System Settings" subtitle="Service connectivity and future configuration." eyebrow="PLATFORM CONFIGURATION"/><div className="settings-layout"><Panel title="Service status"><ServiceStatus/></Panel><Panel title="Operator profile"><div className="account-preview"><div className="avatar">{user?.name?.slice(0,1).toUpperCase()??'?'}</div><div><strong>{user?.name??'Authenticated operator'}</strong><small>{user?.email??'No email provided'} · {user?.role??'security_operator'}</small></div></div><Button variant="outline" onClick={()=>void logout().then(()=>navigate({to:'/login'}))}><LogOut/>Log out</Button></Panel><Panel title="AI Safety Assistant"><div className="empty-state"><BrainCircuit/>AI Safety Assistant will become available when the AI assistant API is connected.</div></Panel></div></>;}
function ServiceStatus(){const {health,monitoring}=useCommand();return <div className="service-list"><div><Radio/><strong>Flask backend</strong><Badge tone={health.online?'normal':'critical'}>{health.online?'Online':'Offline'}</Badge></div><div><Database/><strong>Database</strong><Badge tone="muted">Status unavailable</Badge></div><div><BrainCircuit/><strong>AI Engine</strong><Badge tone={monitoring==='Running'?'normal':'muted'}>{monitoring==='Running'?'Monitoring':'Not available'}</Badge></div></div>;}
function SettingToggle({title,caption}:{title:string;caption:string}){const[on,setOn]=useState(true);return <label className="setting-toggle"><span><strong>{title}</strong><small>{caption}</small></span><input role="switch" type="checkbox" checked={on} onChange={e=>setOn(e.target.checked)}/></label>;}
export function LoginPage(){const{login}=useAuth();const navigate=useNavigate();const[show,setShow]=useState(false);const[identifier,setIdentifier]=useState('');const[password,setPassword]=useState('');const[error,setError]=useState('');const[busy,setBusy]=useState(false);const submit=async(e:FormEvent)=>{e.preventDefault();const cleanIdentifier=identifier.trim();if(!cleanIdentifier){setError('Username or email is required.');return;}if(!password){setError('Password is required.');return;}setError('');setBusy(true);try{await login(cleanIdentifier,password);setPassword('');void navigate({to:'/dashboard',replace:true});}catch(reason){setError(reason instanceof AuthError?reason.message:'Unable to sign in. Please try again.');setPassword('');}finally{setBusy(false);}};return <div className="login-page"><div className="login-scrim"/><div className="login-brand"><div className="brand-mark"><Shield size={26}/></div><div><strong>CROWD<span>GUARD</span></strong><small>AI SAFETY PLATFORM</small></div></div><div className="login-layout"><section className="login-intro"><div className="eyebrow">AUTHORIZED ACCESS / AI OPERATIONS</div><h1>AI CROWD SAFETY</h1><p>Intelligent Crowd Monitoring &amp; Safety Alert System</p><span>Authorized access to the AI-powered crowd monitoring command center.</span><div className="login-signal"><Radio/><span><strong>COMPUTER VISION ONLINE</strong><small>Camera intelligence · Crowd safety · Secure operations</small></span></div></section><section className="login-card"><div className="login-heading"><Badge tone="muted">SECURE AUTHENTICATION</Badge><h2>Secure Login</h2><p>Sign in to access the Crowd Safety Command Center</p></div><form className="login-form" onSubmit={e=>void submit(e)} noValidate><label htmlFor="identifier">Username or Email<input id="identifier" value={identifier} onChange={e=>setIdentifier(e.target.value)} autoComplete="username" placeholder="operator@organization.com" aria-invalid={Boolean(error&& !identifier.trim())}/></label><label htmlFor="password">Password<div className="password-input"><input id="password" value={password} onChange={e=>setPassword(e.target.value)} type={show?'text':'password'} autoComplete="current-password" placeholder="Enter your password" aria-invalid={Boolean(error&& !password)}/><Button variant="ghost" size="icon" type="button" aria-label={show?'Hide password':'Show password'} onClick={()=>setShow(v=>!v)}>{show?<EyeOff/>:<Eye/>}</Button></div></label>{error&&<div role="alert" className="form-note login-error">{error}</div>}<Button size="lg" type="submit" disabled={busy}>{busy?'Signing in...':'Secure Login'}<ArrowRight/></Button><p className="login-notice"><Shield size={14}/> Authorized personnel only. All monitoring access is logged by the system.</p></form></section></div></div>;}
