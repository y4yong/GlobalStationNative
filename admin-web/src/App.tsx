import { useEffect, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  BarChart3,
  Check,
  ChevronRight,
  CircleDollarSign,
  Film,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessagesSquare,
  Eye,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import {
  CircleMarker,
  MapContainer,
  TileLayer,
  useMapEvents,
} from 'react-leaflet';
import { api, login } from './api';

type View =
  | 'overview'
  | 'content'
  | 'payouts'
  | 'campaigns'
  | 'users'
  | 'telemetry'
  | 'support';
const nav: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'content', label: 'Content review', icon: Film },
  { id: 'payouts', label: 'Payouts', icon: CircleDollarSign },
  { id: 'campaigns', label: 'Campaigns', icon: Megaphone },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'telemetry', label: 'Watch telemetry', icon: Activity },
  { id: 'support', label: 'Support tickets', icon: MessagesSquare },
];

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-shell">
      <div className="login-art">
        <span className="eyebrow">GLOBAL STATION / ADMIN</span>
        <h1>
          Make every
          <br />
          <em>decision</em> visible.
        </h1>
        <p>Content · revenue · audience</p>
        <div className="signal-line">
          <span /> live operational systems
        </div>
      </div>
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-mark">
          GS<span>•</span>
        </div>
        <h2>Sign in to Control Room</h2>
        <p className="muted">Administrator access only.</p>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary-button" disabled={busy}>
          {busy ? 'Authenticating...' : 'Enter control room'}{' '}
          <ChevronRight size={17} />
        </button>
      </form>
    </main>
  );
}

function App() {
  const [view, setView] = useState<View>('overview');
  const [mobileNav, setMobileNav] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState('');
  const [overview, setOverview] = useState<any>(null);
  const token = localStorage.getItem('gs_admin_token');
  useEffect(() => {
    if (token)
      api
        .overview()
        .then(setOverview)
        .catch(() => {
          localStorage.removeItem('gs_admin_token');
          window.location.reload();
        });
  }, [token, refresh]);
  if (!token) return <Login />;
  const current = nav.find(item => item.id === view)!;
  async function action(work: () => Promise<unknown>, message: string) {
    try {
      await work();
      setNotice(message);
      setRefresh(value => value + 1);
      setTimeout(() => setNotice(''), 3500);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Action failed');
    }
  }
  return (
    <div className="app-shell">
      <aside className={mobileNav ? 'sidebar open' : 'sidebar'}>
        <div className="sidebar-brand">
          <div className="brand-mark">
            GS<span>•</span>
          </div>
          <div>
            <strong>GLOBAL STATION</strong>
            <small>CONTROL ROOM</small>
          </div>
          <button
            className="icon-button close-nav"
            onClick={() => setMobileNav(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="workspace-chip">
          <span className="status-dot" /> Production workspace
        </div>
        <nav>
          {nav.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={view === item.id ? 'nav-link active' : 'nav-link'}
                onClick={() => {
                  setView(item.id);
                  setMobileNav(false);
                }}
              >
                <Icon size={18} />
                {item.label}
                {item.id === 'content' && overview?.dramas?.pending > 0 && (
                  <b>{overview.dramas.pending}</b>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="admin-chip">
            <div className="avatar">A</div>
            <span>
              <strong>Administrator</strong>
              <small>Full access</small>
            </span>
          </div>
          <button
            className="logout-button"
            onClick={() => {
              localStorage.removeItem('gs_admin_token');
              window.location.reload();
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>
      <section className="main-area">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={20} />
          </button>
          <div>
            <span className="eyebrow">OPERATIONS / {view.toUpperCase()}</span>
            <h1>{current.label}</h1>
          </div>
          <div className="topbar-right">
            <div className="top-avatar">A</div>
          </div>
        </header>
        {notice && (
          <div className="toast">
            <Check size={16} /> {notice}
          </div>
        )}
        <main className="content-area">
          <ViewContent
            view={view}
            overview={overview}
            action={action}
            refresh={refresh}
          />
        </main>
      </section>
    </div>
  );
}

function ViewContent({
  view,
  overview,
  action,
  refresh,
}: {
  view: View;
  overview: any;
  action: (work: () => Promise<unknown>, message: string) => void;
  refresh: number;
}) {
  if (view === 'overview') return <Overview overview={overview} />;
  if (view === 'content') return <ContentReview action={action} refresh={refresh} />;
  if (view === 'payouts') return <Payouts action={action} />;
  if (view === 'campaigns') return <Campaigns action={action} />;
  if (view === 'users') return <UsersView action={action} refresh={refresh} />;
  if (view === 'support')
    return <SupportTickets action={action} refresh={refresh} />;
  return <Telemetry />;
}

function Overview({ overview }: { overview: any }) {
  const cards = [
    {
      label: 'Pending content',
      value: overview?.dramas?.pending ?? '—',
      note: 'needs review',
      icon: Film,
      tone: 'orange',
    },
    {
      label: 'Published library',
      value: overview?.dramas?.published ?? '—',
      note: 'approved titles',
      icon: BadgeCheck,
      tone: 'green',
    },
    {
      label: 'Payouts waiting',
      value: overview?.payouts?.pending ?? '—',
      note: `$${Number(overview?.payouts?.pendingAmount ?? 0).toFixed(
        2,
      )} queued`,
      icon: CircleDollarSign,
      tone: 'blue',
    },
    {
      label: '30-day sessions',
      value: overview?.watch?.sessions ?? '—',
      note: `${overview?.watch?.activeUsers ?? 0} active viewers`,
      icon: BarChart3,
      tone: 'violet',
    },
  ];
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="section-kicker">{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date())}</p>
          <h2>Operations overview</h2>
          <p className="muted">
            Here is what needs your attention across the station.
          </p>
        </div>
        <div className="secure-badge">
          <ShieldCheck size={18} /> Audited workspace
        </div>
      </div>
      <div className="metric-grid">
        {cards.map(card => {
          const Icon = card.icon;
          return (
            <article className={`metric-card ${card.tone}`} key={card.label}>
              <div className="metric-icon">
                <Icon size={19} />
              </div>
              <p>{card.label}</p>
              <strong>{card.value}</strong>
              <small>{card.note}</small>
            </article>
          );
        })}
      </div>
      <div className="overview-grid">
        <section className="panel attention-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">QUEUE HEALTH</p>
              <h3>Attention required</h3>
            </div>
            <Activity size={19} />
          </div>
          <QueueRow
            label="Drama submissions"
            value={overview?.dramas?.pending ?? 0}
            tone="orange"
          />
          <QueueRow
            label="Payout approvals"
            value={overview?.payouts?.pending ?? 0}
            tone="blue"
          />
          <QueueRow
            label="Active campaigns"
            value={overview?.campaigns?.active ?? 0}
            tone="green"
          />
        </section>
        <section className="panel pulse-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">SYSTEM PULSE</p>
              <h3>Platform at a glance</h3>
            </div>
            <div className="pulse-bars">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className="pulse-stat">
            <span>Registered accounts</span>
            <strong>{overview?.users?.total ?? '—'}</strong>
          </div>
          <div className="pulse-stat">
            <span>Creators in network</span>
            <strong>{overview?.users?.creators ?? '—'}</strong>
          </div>
          <div className="pulse-stat">
            <span>Active ad campaigns</span>
            <strong>{overview?.campaigns?.active ?? '—'}</strong>
          </div>
        </section>
      </div>
    </>
  );
}
function QueueRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="queue-row">
      <span className={`queue-dot ${tone}`} />
      <span>{label}</span>
      <strong>{value}</strong>
      <ChevronRight size={16} />
    </div>
  );
}

function ContentReview({
  action,
  refresh,
}: {
  action: (work: () => Promise<unknown>, message: string) => void;
  refresh: number;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState('IN_REVIEW');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    title: '',
    contentType: 'MOVIE',
    description: '',
    rating: 'P13',
    genre: 'Drama',
    category: 'Malay Drama',
    isExclusiveVip: false,
    episodeTitle: '',
    durationSeconds: '2400',
    latitude: '',
    longitude: '',
  });
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.content(filter)
      .then(result => { if (active) setRows(result); })
      .catch(requestError => {
        if (!active) return;
        setRows([]);
        setError(requestError instanceof Error ? requestError.message : 'Unable to load content.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filter, refresh, reload]);
  const visibleRows = rows.filter(row => `${row.title} ${row.creatorName ?? ''} ${row.creatorEmail ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const update = (key: string, value: string | boolean) =>
    setForm(current => ({ ...current, [key]: value }));
  const validateFile = (
    file: File | undefined,
    purpose: 'poster' | 'media',
  ) => {
    if (!file) return null;
    const allowed =
      purpose === 'poster'
        ? ['image/jpeg', 'image/png', 'image/webp']
        : ['video/mp4'];
    const maximum =
      purpose === 'poster' ? 10 * 1024 * 1024 : 5 * 1024 * 1024 * 1024;
    if (!allowed.includes(file.type))
      throw new Error(
        purpose === 'poster'
          ? 'Poster must be JPEG, PNG, or WebP.'
          : 'Media must be an MP4 video.',
      );
    if (file.size < 1 || file.size > maximum)
      throw new Error(
        purpose === 'poster'
          ? 'Poster must be 10 MB or smaller.'
          : 'Media exceeds the 5 GB upload limit.',
      );
    return file;
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (!posterFile || !mediaFile)
        throw new Error('Choose both a poster image and an MP4 media file.');
      const [posterKey, mediaKey] = await Promise.all([
        api.uploadMediaFile('poster', posterFile),
        api.uploadMediaFile('media', mediaFile),
      ]);
      await api.createContent({
        ...form,
        durationSeconds: Number(form.durationSeconds),
        latitude: form.latitude ? Number(form.latitude) : undefined,
        longitude: form.longitude ? Number(form.longitude) : undefined,
        posterKey,
        mediaKey,
      });
      action(
        async () => undefined,
        'Content and uploaded media saved to the catalog.',
      );
      setRows(await api.content(filter));
      setShowForm(false);
      setPosterFile(null);
      setMediaFile(null);
      setForm({
        title: '',
        contentType: 'MOVIE',
        description: '',
        rating: 'P13',
        genre: 'Drama',
        category: 'Malay Drama',
        isExclusiveVip: false,
        episodeTitle: '',
        durationSeconds: '2400',
        latitude: '',
        longitude: '',
      });
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Unable to save content.',
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div className="review-page-heading">
        <PageTitle
          kicker="LIBRARY GOVERNANCE"
          title="Content review"
          description="Review creator submissions, inspect every asset and detail, then publish or reject."
        />
        <div className="review-page-actions">
          <button className="secondary-button" onClick={() => setReload(value => value + 1)} disabled={loading}>
            <RefreshCw size={15} /> Refresh queue
          </button>
          <button className="primary-button compact" onClick={() => setShowForm(value => !value)}>
            {showForm ? 'Close form' : '+ Add content'}
          </button>
        </div>
      </div>
      {showForm && (
        <form className="panel content-form" onSubmit={submit}>
          <div className="form-grid">
            <label>
              Title
              <input
                value={form.title}
                onChange={event => update('title', event.target.value)}
                minLength={2}
                required
              />
            </label>
            <label>
              Poster image
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                required
                onChange={event => {
                  try {
                    setPosterFile(
                      validateFile(event.target.files?.[0], 'poster'),
                    );
                    setFormError('');
                  } catch (error) {
                    setPosterFile(null);
                    setFormError(
                      error instanceof Error
                        ? error.message
                        : 'Invalid poster.',
                    );
                    event.target.value = '';
                  }
                }}
              />
              <small>
                JPEG, PNG, or WebP. Maximum 10 MB.
                {posterFile ? ` Selected: ${posterFile.name}` : ''}
              </small>
            </label>
            <label>
              Media file
              <input
                type="file"
                accept="video/mp4,.mp4"
                required
                onChange={event => {
                  try {
                    setMediaFile(
                      validateFile(event.target.files?.[0], 'media'),
                    );
                    setFormError('');
                  } catch (error) {
                    setMediaFile(null);
                    setFormError(
                      error instanceof Error ? error.message : 'Invalid video.',
                    );
                    event.target.value = '';
                  }
                }}
              />
              <small>
                MP4. Maximum 5 GB.
                {mediaFile ? ` Selected: ${mediaFile.name}` : ''}
              </small>
            </label>
            <label>
              Genre
              <select
                value={form.genre}
                onChange={event => update('genre', event.target.value)}
              >
                {[
                  'Action',
                  'Comedy',
                  'Crime',
                  'Documentary',
                  'Drama',
                  'Family',
                  'Horror',
                  'Romance',
                  'Science Fiction',
                  'Thriller',
                ].map(value => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select
                value={form.category}
                onChange={event => update('category', event.target.value)}
              >
                {[
                  'Documentary',
                  'Film',
                  'Malay Drama',
                  'Original Series',
                  'Korean Drama',
                  'Variety',
                ].map(value => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Rating
              <select
                value={form.rating}
                onChange={event => update('rating', event.target.value)}
              >
                {['U', 'P12', 'P13', '16', '18'].map(value => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Duration seconds
              <input
                type="number"
                min="1"
                value={form.durationSeconds}
                onChange={event =>
                  update('durationSeconds', event.target.value)
                }
                required
              />
            </label>
            <label>
              Type
              <select
                value={form.contentType}
                onChange={event => update('contentType', event.target.value)}
              >
                <option value="MOVIE">Movie</option>
                <option value="SERIES">Series</option>
              </select>
            </label>
            <label>
              Episode title
              <input
                value={form.episodeTitle}
                onChange={event => update('episodeTitle', event.target.value)}
                required
              />
            </label>
            <label className="wide-field">
              Description
              <textarea
                value={form.description}
                onChange={event => update('description', event.target.value)}
                minLength={10}
                required
              />
            </label>
            <div className="wide-field">
              <span className="form-label">Origin point (optional)</span>
              <p className="muted">
                Click the map to choose coordinates, or enter them below.
              </p>
              <CoordinatePicker
                latitude={form.latitude}
                longitude={form.longitude}
                onPick={(latitude, longitude) => {
                  update('latitude', latitude.toFixed(6));
                  update('longitude', longitude.toFixed(6));
                }}
              />
              <div className="coordinate-fields">
                <label>
                  Latitude
                  <input
                    type="number"
                    min="-90"
                    max="90"
                    step="any"
                    value={form.latitude}
                    onChange={event => update('latitude', event.target.value)}
                  />
                </label>
                <label>
                  Longitude
                  <input
                    type="number"
                    min="-180"
                    max="180"
                    step="any"
                    value={form.longitude}
                    onChange={event => update('longitude', event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    update('latitude', '');
                    update('longitude', '');
                  }}
                >
                  Clear point
                </button>
              </div>
            </div>
            <label className="check-field">
              <input
                type="checkbox"
                checked={form.isExclusiveVip}
                onChange={event =>
                  update('isExclusiveVip', event.target.checked)
                }
              />{' '}
              VIP exclusive
            </label>
          </div>
          {formError && <div className="form-error">{formError}</div>}
          <button className="primary-button form-submit" disabled={saving}>
            {saving
              ? 'Uploading files and saving...'
              : 'Upload and create content'}
          </button>
        </form>
      )}
      <div className="review-toolbar">
        <div className="filter-tabs">
          {['IN_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED', 'ALL'].map(status => (
            <button
              className={filter === status ? 'selected' : ''}
              key={status}
              onClick={() => setFilter(status)}
            >
              {status === 'IN_REVIEW' ? 'Needs review' : status === 'ALL' ? 'All' : status[0] + status.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <label className="review-search"><Search size={16} /><input aria-label="Search submissions" placeholder="Search title or creator" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <span className="row-count">{visibleRows.length} of {rows.length} titles</span>
      </div>
      <section className="panel table-panel">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Creator</th>
              <th>Submitted</th>
              <th>Format</th>
              <th>Episodes</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(row => (
              <tr key={row.id}>
                <td>
                  <div className="title-cell">
                    <div className="poster">
                      <Film size={16} />
                    </div>
                    <span>
                      <strong>{row.title}</strong>
                      <small>{row.category} · {row.genre}</small>
                    </span>
                  </div>
                </td>
                <td><strong>{row.creatorName ?? 'Unknown creator'}</strong><small className="table-sub">{row.creatorEmail ?? 'No creator email'}</small></td>
                <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                <td><strong>{row.contentType}</strong><small className="table-sub">{row.category} · {row.genre} · {row.rating}</small></td>
                <td>{row.episodeCount}</td>
                <td>
                  <Status value={row.isArchived ? 'ARCHIVED' : row.status} />
                </td>
                <td>
                  <button className="inspect-button" onClick={() => setSelectedId(row.id)}><Eye size={15} /> Review</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="queue-message">Loading submissions…</div>}
        {!loading && rows.length === 0 && !error && (
          <Empty text={filter === 'IN_REVIEW' ? 'No creator submissions are waiting for review.' : 'No titles match this filter.'} />
        )}
        {!loading && rows.length > 0 && visibleRows.length === 0 && !error && <Empty text="No submissions match your search." />}
        {error && <div className="form-error">{error}</div>}
      </section>
      <ContentInspector id={selectedId} refresh={refresh} onClose={() => setSelectedId(null)} action={action} />
    </>
  );
}

function ContentInspector({
  id,
  refresh,
  onClose,
  action,
}: {
  id: string | null;
  refresh: number;
  onClose: () => void;
  action: (work: () => Promise<unknown>, message: string) => void;
}) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    setError('');
    api.contentDetail(id)
      .then(result => { if (active) setDetail(result); })
      .catch(requestError => { if (active) setError(requestError instanceof Error ? requestError.message : 'Unable to load submission details.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, refresh]);

  if (!id) return null;
  const moderate = (status: 'APPROVED' | 'REJECTED') => {
    setSaving(true);
    action(
      () => api.contentStatus(id, status).finally(() => setSaving(false)),
      status === 'APPROVED' ? 'Content approved and published.' : 'Content rejected and logged.',
    );
  };

  function toggleArchive() {
    if (!detail || !id) return;
    const archived = !detail.isArchived;
    action(
      () => api.contentArchive(id, archived),
      archived ? 'Content archived.' : 'Content restored to the library.',
    );
  }

  function deletePermanently() {
    if (!detail || !id || !window.confirm(`Delete “${detail.title}” permanently? Its uploaded poster and episode media will also be deleted. This cannot be undone.`)) return;
    action(() => api.deleteContent(id), 'Content and uploaded media deleted.');
    onClose();
  }

  return (
    <div className="review-backdrop" onClick={onClose}>
      <section className="review-drawer" role="dialog" aria-modal="true" aria-labelledby="review-title" onClick={event => event.stopPropagation()}>
        <header className="review-drawer-header">
          <div><span className="section-kicker">CREATOR SUBMISSION</span><h2 id="review-title">{detail?.title ?? 'Submission details'}</h2></div>
          <button className="icon-button drawer-close" onClick={onClose} aria-label="Close review details"><X size={19} /></button>
        </header>
        {loading && <div className="queue-message">Loading complete submission…</div>}
        {error && <div className="form-error drawer-error">{error}</div>}
        {detail && !loading && <>
          <div className="review-drawer-scroll">
            <div className="review-overview">
              {detail.posterUrl ? <img className="review-poster" src={detail.posterUrl} alt={`${detail.title} poster`} /> : <div className="review-poster poster-fallback"><Film size={25} /></div>}
              <div className="review-summary">
                <Status value={detail.isArchived ? 'ARCHIVED' : detail.status} />
                <h3>{detail.title}</h3>
                <p>{detail.contentType} · {detail.category} · {detail.genre}</p>
                <div className="review-tags"><span>Rating {detail.rating}</span>{detail.isExclusiveVip && <span>VIP exclusive</span>}{detail.isFeatured && <span>Featured</span>}</div>
              </div>
            </div>
            <section className="detail-section">
              <h3>Creator</h3>
              <dl className="detail-grid">
                <div><dt>Name</dt><dd>{detail.creatorName ?? 'Unknown creator'}</dd></div>
                <div><dt>Email</dt><dd>{detail.creatorEmail ?? 'Not provided'}</dd></div>
                <div><dt>Account ID</dt><dd className="detail-code">{detail.creatorId ?? 'Not available'}</dd></div>
              </dl>
            </section>
            <section className="detail-section">
              <h3>Submission</h3>
              <dl className="detail-grid">
                <div><dt>Submitted</dt><dd>{new Date(detail.createdAt).toLocaleString()}</dd></div>
                <div><dt>Last updated</dt><dd>{detail.updatedAt ? new Date(detail.updatedAt).toLocaleString() : 'Not updated'}</dd></div>
                <div><dt>Content ID</dt><dd className="detail-code">{detail.id}</dd></div>
                <div><dt>Episodes</dt><dd>{detail.episodes.length}</dd></div>
              </dl>
            </section>
            <section className="detail-section">
              <h3>Synopsis</h3>
              <p className="detail-description">{detail.description || 'No description provided.'}</p>
            </section>
            <section className="detail-section">
              <h3>Episode media</h3>
              {detail.episodes.map((episode: any) => <article className="episode-review" key={episode.id}>
                <div className="episode-review-heading"><strong>Episode {episode.episodeNumber}: {episode.title}</strong><span>{Math.floor(episode.durationSeconds / 60)} min · {episode.isFreePreview ? 'Free preview' : 'VIP'}</span></div>
                {episode.mediaUrl ? <video controls preload="metadata" src={episode.mediaUrl}>Your browser cannot play this video.</video> : <p className="muted">No playable media source is available.</p>}
              </article>)}
              {detail.episodes.length === 0 && <p className="muted">No episode files were attached.</p>}
            </section>
          </div>
          <footer className="review-drawer-footer">
            <button className="secondary-button" onClick={onClose}>Close</button>
            <div className="review-lifecycle-actions">
              <button className="secondary-button" disabled={saving} onClick={toggleArchive}>{detail.isArchived ? 'Restore' : 'Archive'}</button>
              <button className="reject-button" disabled={saving} onClick={deletePermanently}>Delete</button>
              {detail.status === 'IN_REVIEW' && !detail.isArchived && <div className="row-actions"><button className="reject-button" disabled={saving} onClick={() => moderate('REJECTED')}>Reject</button><button className="approve-button" disabled={saving} onClick={() => moderate('APPROVED')}>{saving ? 'Saving…' : 'Approve'}</button></div>}
            </div>
          </footer>
        </>}
      </section>
    </div>
  );
}

function CoordinatePicker({
  latitude,
  longitude,
  onPick,
}: {
  latitude: string;
  longitude: string;
  onPick: (latitude: number, longitude: number) => void;
}) {
  const selected =
    latitude !== '' && longitude !== ''
      ? ([Number(latitude), Number(longitude)] as [number, number])
      : null;
  return (
    <div className="map-picker">
      <MapContainer
        center={selected ?? [3.139, 101.6869]}
        zoom={selected ? 12 : 6}
        scrollWheelZoom
        className="coordinate-map"
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapPoint selected={selected} onPick={onPick} />
      </MapContainer>
    </div>
  );
}

function MapPoint({
  selected,
  onPick,
}: {
  selected: [number, number] | null;
  onPick: (latitude: number, longitude: number) => void;
}) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return selected ? (
    <CircleMarker
      center={selected}
      radius={8}
      pathOptions={{ color: '#315d48', fillColor: '#7fb18a', fillOpacity: 0.9 }}
    />
  ) : null;
}

function Payouts({
  action,
}: {
  action: (work: () => Promise<unknown>, message: string) => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    api
      .payouts()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  return (
    <>
      <PageTitle
        kicker="REVENUE OPERATIONS"
        title="Payout approvals"
        description="Review creator earnings before funds leave the platform."
      />
      <section className="panel table-panel">
        <table>
          <thead>
            <tr>
              <th>Creator</th>
              <th>Requested</th>
              <th>Amount</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                <td>
                  <strong>{row.creatorName}</strong>
                  <small className="table-sub">{row.creatorEmail}</small>
                </td>
                <td>{new Date(row.requestedAt).toLocaleDateString()}</td>
                <td className="amount">${Number(row.amount).toFixed(2)}</td>
                <td>
                  <Status value={row.status} />
                </td>
                <td>
                  {row.status === 'PENDING' && (
                    <div className="row-actions">
                      <button
                        className="approve"
                        onClick={() =>
                          action(
                            () => api.payoutStatus(row.id, 'APPROVED'),
                            'Payout approved.',
                          )
                        }
                      >
                        Approve
                      </button>
                      <button
                        className="reject"
                        onClick={() =>
                          action(
                            () => api.payoutStatus(row.id, 'REJECTED'),
                            'Payout rejected.',
                          )
                        }
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty text="No payout requests yet." />}
      </section>
    </>
  );
}

function Campaigns({
  action,
}: {
  action: (work: () => Promise<unknown>, message: string) => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    api
      .campaigns()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  return (
    <>
      <PageTitle
        kicker="ADVERTISING OPERATIONS"
        title="Campaign control"
        description="Review submitted campaigns and activate or pause delivery."
      />
      <div className="campaign-grid">
        {rows.map(row => (
          <article className="panel campaign-card" key={row.id}>
            <div className="campaign-top">
              <div className="campaign-symbol">
                <Megaphone size={18} />
              </div>
              <Status value={row.status} />
            </div>
            <h3>{row.campaignName}</h3>
            <p className="muted">Targeting {row.targetTier} viewers</p>
            <div className="budget-line">
              <span>Budget remaining</span>
              <strong>RM {Number(row.remainingBudget).toLocaleString()}</strong>
            </div>
            <div className="budget-track">
              <span
                style={{
                  width: `${Math.min(
                    100,
                    (Number(row.remainingBudget) /
                      Math.max(1, Number(row.totalBudget))) *
                      100,
                  )}%`,
                }}
              />
            </div>
            <div className="campaign-foot">
              <span>RM {Number(row.cpmRate).toFixed(2)} CPM</span>
              {row.status === 'ACTIVE' ? (
                <button
                  className="text-button"
                  onClick={() =>
                    action(
                      () => api.campaignStatus(row.id, 'PAUSED'),
                      'Campaign paused.',
                    )
                  }
                >
                  Pause campaign
                </button>
              ) : row.status === 'PAUSED' ? (
                <button
                  className="text-button"
                  onClick={() =>
                    action(
                      () => api.campaignStatus(row.id, 'ACTIVE'),
                      'Campaign activated.',
                    )
                  }
                >
                  Activate campaign
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {rows.length === 0 && <Empty text="No campaigns have been created." />}
    </>
  );
}

function UsersView({
  action,
  refresh,
}: {
  action: (work: () => Promise<unknown>, message: string) => void;
  refresh: number;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('ALL');
  const [plan, setPlan] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [nextPlan, setNextPlan] = useState('FREE');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .users({ search, role, plan, status })
      .then(setRows)
      .catch(requestError =>
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load users.',
        ),
      );
  }, [search, role, plan, status, refresh]);

  function openPlanEditor(user: any) {
    setSelectedUser(user);
    setNextPlan(user.planCode === 'FREE' ? 'VIP_MONTHLY' : user.planCode);
    setConfirmation('');
    setError('');
  }

  async function savePlan() {
    if (!selectedUser) return;
    if (nextPlan === 'FREE' && confirmation !== 'REVOKEPLAN') {
      setError('Type REVOKEPLAN exactly to revoke this plan.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.userPlan(selectedUser.id, nextPlan, confirmation);
      action(
        async () => undefined,
        nextPlan === 'FREE' ? 'VIP plan revoked.' : 'User plan updated.',
      );
      setSelectedUser(null);
      setRows(await api.users({ search, role, plan, status }));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to update plan.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageTitle
        kicker="IDENTITY & ACCESS"
        title="Users"
        description="Search accounts, filter membership, and manage plans."
      />
      <div className="user-filters">
        <label className="user-search">
          <Search size={17} />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search name or email"
          />
        </label>
        <label>
          Role
          <select value={role} onChange={event => setRole(event.target.value)}>
            <option value="ALL">All roles</option>
            {['VIEWER', 'CREATOR', 'ADVERTISER', 'ADMIN'].map(value => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Plan
          <select value={plan} onChange={event => setPlan(event.target.value)}>
            <option value="ALL">All plans</option>
            <option value="FREE">Free</option>
            <option value="VIP_MONTHLY">VIP monthly</option>
            <option value="VIP_YEARLY">VIP yearly</option>
          </select>
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={event => setStatus(event.target.value)}
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </label>
      </div>
      <section className="panel table-panel">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Role</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Joined</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                <td>
                  <strong>{row.name}</strong>
                  <small className="table-sub">{row.email}</small>
                </td>
                <td>
                  <span className="role-label">{row.role}</span>
                </td>
                <td>
                  {row.planCode?.replace('_', ' ') ??
                    (row.isVip ? 'VIP' : 'FREE')}
                  {row.renewsAt && (
                    <small className="table-sub">
                      Until {new Date(row.renewsAt).toLocaleDateString()}
                    </small>
                  )}
                </td>
                <td>
                  <Status value={row.status} />
                </td>
                <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => openPlanEditor(row)}
                  >
                    Change plan
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !error && (
          <Empty text="No users match these filters." />
        )}
        {error && <div className="form-error">{error}</div>}
      </section>
      {selectedUser && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plan-dialog-title"
          >
            <button
              className="icon-button modal-close"
              aria-label="Close"
              onClick={() => setSelectedUser(null)}
            >
              <X size={18} />
            </button>
            <p className="section-kicker">USER PLAN</p>
            <h2 id="plan-dialog-title">{selectedUser.name}</h2>
            <p className="muted">{selectedUser.email}</p>
            <label>
              New plan
              <select
                value={nextPlan}
                onChange={event => {
                  setNextPlan(event.target.value);
                  setConfirmation('');
                  setError('');
                }}
              >
                <option value="FREE">Free</option>
                <option value="VIP_MONTHLY">VIP monthly</option>
                <option value="VIP_YEARLY">VIP yearly</option>
              </select>
            </label>
            {nextPlan === 'FREE' && (
              <>
                <p className="revoke-warning">
                  Revoking VIP access takes effect immediately. It does not
                  refund a payment.
                </p>
                <label>
                  Type <strong>REVOKEPLAN</strong> to confirm
                  <input
                    value={confirmation}
                    onChange={event => setConfirmation(event.target.value)}
                    autoComplete="off"
                  />
                </label>
              </>
            )}
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setSelectedUser(null)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className={
                  nextPlan === 'FREE' ? 'danger-button' : 'primary-button'
                }
                onClick={savePlan}
                disabled={
                  saving ||
                  (nextPlan === 'FREE' && confirmation !== 'REVOKEPLAN')
                }
              >
                {saving
                  ? 'Saving...'
                  : nextPlan === 'FREE'
                  ? 'Revoke VIP plan'
                  : 'Apply plan'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function SupportTickets({
  action,
  refresh,
}: {
  action: (work: () => Promise<unknown>, message: string) => void;
  refresh: number;
}) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    api
      .supportTickets()
      .then(setRows)
      .catch(() => setRows([]));
  }, [refresh]);
  return (
    <>
      <PageTitle
        kicker="CUSTOMER CARE"
        title="Support tickets"
        description="Review customer requests and update their status."
      />
      <section className="panel table-panel">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Request</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Received</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                <td>
                  <strong>{row.userName ?? 'Deleted account'}</strong>
                  <small className="table-sub">{row.userEmail ?? ''}</small>
                </td>
                <td>
                  <strong>{row.subject}</strong>
                  <small className="table-sub">{row.description}</small>
                </td>
                <td>{row.priority}</td>
                <td>
                  <select
                    aria-label={`Status for ${row.subject}`}
                    value={row.status}
                    onChange={event =>
                      action(
                        () => api.supportStatus(row.id, event.target.value),
                        'Support ticket updated.',
                      )
                    }
                  >
                    <option value="OPEN">Open</option>
                    <option value="IN_PROGRESS">In progress</option>
                    <option value="RESOLVED">Resolved</option>
                    <option value="CLOSED">Closed</option>
                  </select>
                </td>
                <td>{new Date(row.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <Empty text="No support requests have been submitted." />
        )}
      </section>
    </>
  );
}

function Telemetry() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    api
      .telemetry()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  const max = Math.max(1, ...rows.map(row => Number(row.watchSeconds)));
  return (
    <>
      <PageTitle
        kicker="AUDIENCE INTELLIGENCE"
        title="Watch telemetry"
        description="A 14-day view of playback activity reported by mobile clients."
      />
      <section className="panel chart-panel">
        <div className="panel-heading">
          <div>
            <h3>Watch minutes</h3>
            <p className="muted">Daily playback duration</p>
          </div>
          <BarChart3 size={20} />
        </div>
        <div className="chart">
          {rows.map(row => (
            <div className="chart-column" key={row.day}>
              <span className="chart-value">
                {Math.round(Number(row.watchSeconds) / 60)}m
              </span>
              <i
                style={{
                  height: `${Math.max(
                    4,
                    (Number(row.watchSeconds) / max) * 190,
                  )}px`,
                }}
              />
              <small>{String(row.day).slice(5)}</small>
            </div>
          ))}
        </div>
        {rows.length === 0 && (
          <Empty text="Telemetry will appear as viewers watch." />
        )}
      </section>
    </>
  );
}

function PageTitle({
  kicker,
  title,
  description,
}: {
  kicker: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-title">
      <p className="section-kicker">{kicker}</p>
      <h2>{title}</h2>
      <p className="muted">{description}</p>
    </div>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value.toLowerCase()}`}>
      {value.replace('_', ' ')}
    </span>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <ShieldCheck size={22} />
      <span>{text}</span>
    </div>
  );
}

export default App;
