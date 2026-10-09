import React, { useState, useEffect, useRef } from 'react';
import { keepLocalCopy, pick, types } from '@react-native-documents/picker';
import ReactNativeBlobUtil from 'react-native-blob-util';
import Video from 'react-native-video';
import {
  ActivityIndicator,
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
  StatusBar,
  Platform,
  Alert,
  Linking,
  Image,
  Modal,
} from 'react-native';
import { DramaItem, UserRole } from './src/data/models/Drama';
import { COLORS } from './src/theme/colors';
import { ProtectedVideoPlayer } from './src/components/ProtectedVideoPlayer';
import { AdPayload, archiveCreatorContent, createAdvertiserCampaign, createAdvertiserUpload, createCreatorPosterUpload, createCreatorUpload, createSupportTicket, createVipCheckout, deleteCreatorContent, getAdPayload, getCatalog, getContinueWatching, getCreatorDashboard, getCurrentSubscription, getViewerProfile, listAdvertiserCampaigns, listSupportTickets, loginViewer, registerViewer, requestCreatorPayout, searchCatalog, submitCreatorContent, upgradeViewerRole, ViewerProfile, ContinueWatchingItem } from './src/api/client';
import { clearSession, readSession } from './src/core/security/sessionStorage';

export default function App() {
  const [activeTab, setActiveTab] = useState<'Home' | 'Search' | 'Creator' | 'Ads' | 'Profile'>('Home');
  const [currentScreen, setCurrentScreen] = useState<'Tabs' | 'Details' | 'Player' | 'Payout' | 'Upload' | 'Campaign' | 'Checkout' | 'Support'>('Tabs');
  const [catalog, setCatalog] = useState<DramaItem[]>([]);
  const [continueWatching, setContinueWatching] = useState<ContinueWatchingItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedDrama, setSelectedDrama] = useState<DramaItem | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState('');
  const [resumeAtSeconds, setResumeAtSeconds] = useState(0);
  const [resumeEpisodeId, setResumeEpisodeId] = useState<string | null>(null);
  const [loadedVideoDuration, setLoadedVideoDuration] = useState<number | null>(null);
  const [adBreakComplete, setAdBreakComplete] = useState(false);
  const [profile, setProfile] = useState<ViewerProfile | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    readSession().then(async (session) => {
      if (!session) return;
      try {
        setProfile(await getViewerProfile());
      } catch {
        await clearSession();
      }
    }).catch(() => undefined).finally(() => setSessionReady(true));
  }, []);

  const loadCatalog = () => {
    setCatalogLoading(true);
    setCatalogError(null);
    Promise.all([
      getCatalog(),
      getContinueWatching(),
    ])
      .then(([items, history]) => {
        setCatalog(items.filter((item) => !!item && typeof item.id === 'string' && item.id.trim().length > 0));
        setContinueWatching(history.filter((item) => !!item && typeof item.episodeId === 'string' && item.episodeId.trim().length > 0));
      })
      .catch(() => setCatalogError('The catalog is unavailable. Check the API connection and try again.'))
      .finally(() => setCatalogLoading(false));
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  if (!sessionReady) {
    return <SafeAreaView style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={COLORS.cyan} /></SafeAreaView>;
  }

  if (!profile) {
    return <AuthScreen onAuthenticated={setProfile} />;
  }

  const availableTabs = [
    { key: 'Home', icon: '⌂', label: 'Home' },
    { key: 'Search', icon: '⚲', label: 'Search' },
    ...(profile.role === 'ADMIN' || profile.roles?.includes('CREATOR') || profile.role === 'CREATOR' ? [{ key: 'Creator', icon: '▣', label: 'Creator' }] : []),
    ...(profile.role === 'ADMIN' || profile.roles?.includes('ADVERTISER') || profile.role === 'ADVERTISER' ? [{ key: 'Ads', icon: '▤', label: 'Ads' }] : []),
    { key: 'Profile', icon: '◉', label: 'Profile' },
  ];

  const openDramaDetails = (drama: DramaItem) => {
    setSelectedDrama(drama);
    setCurrentScreen('Details');
  };

  const formatPlaybackTime = (seconds: number) => {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const startPlayback = (drama: DramaItem, epTitle?: string, resumeAtSeconds = 0, resumeEpisodeId?: string) => {
    const episode = resumeEpisodeId
      ? drama.episodes.find((item) => item.id === resumeEpisodeId) ?? drama.episodes[0]
      : drama.episodes.find((item) => item.title === epTitle) ?? drama.episodes[0];
    if (!episode) {
      Alert.alert('Playback unavailable', 'This title does not have an episode with a media source yet.');
      return;
    }
    setSelectedDrama(drama);
    setSelectedEpisode(episode.title);
    setResumeAtSeconds(resumeAtSeconds);
    setResumeEpisodeId(episode.id);
    setLoadedVideoDuration(null);
    setAdBreakComplete(false);
    setCurrentScreen('Player');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle="light-content"
        {...(Platform.OS === 'android' ? { backgroundColor: COLORS.bg } : {})}
      />

      {/* ===================== VIEW ROUTING ===================== */}
      {currentScreen === 'Details' && selectedDrama ? (
        /* SCREEN 2: EPISODE DETAILS */
        <View style={{ flex: 1 }}>
          <View style={styles.topHeader}>
            <TouchableOpacity onPress={() => setCurrentScreen('Tabs')}>
              <Text style={styles.backBtnText}>‹ Back to Home</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }}>
            <View style={styles.heroCard}>
              <PosterImage uri={selectedDrama.posterUrl} title={selectedDrama.title} badge={selectedDrama.badge} style={styles.heroPosterImage} />
              <View style={styles.heroGradient}>
                <View style={styles.vipTag}><Text style={styles.vipTagText}>{selectedDrama.badge}</Text></View>
                <Text style={styles.heroDramaTitle}>{selectedDrama.title}</Text>
                <Text style={styles.heroSub}>{selectedDrama.genre} • {selectedDrama.rating}</Text>
              </View>
            </View>

            <Text style={styles.dramaDescription}>{selectedDrama.description}</Text>

            <TouchableOpacity
              style={styles.cyanPrimaryBtn}
              activeOpacity={0.8}
              onPress={() => startPlayback(selectedDrama, selectedDrama.episodes[0]?.title)}
            >
              <Text style={styles.cyanPrimaryBtnText}>▶ Play Episode</Text>
            </TouchableOpacity>

            {continueWatching.find((item) => item.id === selectedDrama.id) && (
              <TouchableOpacity
                style={[styles.cyanPrimaryBtn, { marginTop: 12, backgroundColor: '#0f172a', borderColor: '#22d3ee', borderWidth: 1 }]}
                activeOpacity={0.8}
                onPress={() => {
                  const item = continueWatching.find((entry) => entry.id === selectedDrama.id);
                  if (item) {
                    startPlayback(selectedDrama, item.episodeTitle, item.resumeAtSeconds, item.episodeId);
                  }
                }}
              >
                <Text style={styles.cyanPrimaryBtnText}>
                  {`▶ Resume from ${formatPlaybackTime(continueWatching.find((item) => item.id === selectedDrama.id)?.resumeAtSeconds ?? 0)}${loadedVideoDuration ? ` / ${formatPlaybackTime(loadedVideoDuration)}` : ''}`}
                </Text>
              </TouchableOpacity>
            )}

            <Text style={styles.sectionHeaderTitle}>Episode Details</Text>
            {selectedDrama.episodes.map((ep) => (
              <View key={ep.id} style={styles.episodeCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.episodeTitle}>{ep.title}</Text>
                  <Text style={styles.episodeMeta}>{ep.duration} • {ep.rating}</Text>
                </View>
                <TouchableOpacity
                  style={styles.cyanSmallBtn}
                  onPress={() => startPlayback(selectedDrama, ep.title)}
                >
                  <Text style={styles.cyanSmallBtnText}>Play</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : currentScreen === 'Player' && selectedDrama ? (
        /* SCREEN 3: AUTHORIZED VIDEO PLAYER */
        <View style={styles.playerContainer}>
          <View style={styles.playerTopBar}>
            <TouchableOpacity onPress={() => setCurrentScreen('Tabs')}>
              <Text style={styles.backBtnText}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.playerScreenTitle} numberOfLines={1}>{selectedDrama.title} ({selectedDrama.rating})</Text>
          </View>

          <View style={styles.videoStage}>
            <ProtectedVideoPlayer
              episodeId={selectedDrama.episodes.find((episode) => episode.title === selectedEpisode)!.id}
              paused={!adBreakComplete}
              startTime={resumeAtSeconds}
              onDurationChange={setLoadedVideoDuration}
            />
            {!adBreakComplete && <AdBreak onComplete={() => setAdBreakComplete(true)} />}
          </View>
        </View>
      ) : currentScreen === 'Payout' ? (
        <PayoutScreen onBack={() => setCurrentScreen('Tabs')} />
      ) : currentScreen === 'Upload' ? (
        <UploadScreen onBack={() => setCurrentScreen('Tabs')} />
      ) : currentScreen === 'Campaign' ? (
        <CampaignScreen onBack={() => setCurrentScreen('Tabs')} />
      ) : currentScreen === 'Checkout' ? (
        <CheckoutScreen onBack={() => setCurrentScreen('Tabs')} />
      ) : currentScreen === 'Support' ? (
        <SupportScreen onBack={() => setCurrentScreen('Tabs')} />
      ) : (
        /* SCREEN 1, 4, 5, 6: TAB VIEWS */
        <View style={{ flex: 1 }}>
          {activeTab === 'Home' && <HomeTabView dramas={catalog} continueWatching={continueWatching} loading={catalogLoading} error={catalogError} onRetry={loadCatalog} onSelect={openDramaDetails} onPlay={startPlayback} onContinueWatching={(item) => {
            const drama = catalog.find((entry) => entry.id === item.id) ?? {
              id: item.id,
              title: item.title,
              category: item.category,
              genre: item.genre,
              rating: item.rating,
              badge: item.badge,
              posterUrl: item.posterUrl,
              description: item.description,
              episodes: [{ id: item.episodeId, title: item.episodeTitle, duration: `${Math.round(item.durationSeconds / 60)} min`, rating: item.rating }],
            };
            startPlayback(drama, item.episodeTitle, item.resumeAtSeconds, item.episodeId);
          }} onSearch={() => setActiveTab('Search')} onProfile={() => setActiveTab('Profile')} />}
          {activeTab === 'Search' && <SearchTabView dramas={catalog} loading={catalogLoading} onSelect={openDramaDetails} />}
          {activeTab === 'Creator' && <CreatorTabView creatorName={profile.name} onUpload={() => setCurrentScreen('Upload')} />}
          {activeTab === 'Ads' && <AdsTabView onCampaign={() => setCurrentScreen('Campaign')} />}
          {activeTab === 'Profile' && <ProfileTabView profile={profile} onSupport={() => setCurrentScreen('Support')} onRefreshProfile={async () => { const updated = await getViewerProfile(); setProfile(updated); }} onUpgradeRole={async (role) => { const updated = await upgradeViewerRole(role); setProfile(updated); }} onSignOut={async () => { await clearSession(); setProfile(null); setCurrentScreen('Tabs'); setActiveTab('Home'); }} />}
        </View>
      )}

      {/* ===================== BOTTOM NAVIGATION ===================== */}
      <View style={styles.bottomNav}>
        {availableTabs.map((tab) => {
          const isActive = activeTab === tab.key && currentScreen === 'Tabs';
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.navItem}
              onPress={() => {
                setActiveTab(tab.key as any);
                setCurrentScreen('Tabs');
              }}
            >
              <Text style={[styles.navIcon, isActive && { color: COLORS.cyan }]}>{tab.icon}</Text>
              <Text style={[styles.navLabel, isActive && { color: COLORS.cyan }]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (profile: ViewerProfile) => void }) {
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('VIEWER');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const profile = registering
        ? await registerViewer(name, email, password, role)
        : await loginViewer(email, password);
      onAuthenticated(profile);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to connect to your account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.container, { justifyContent: 'center', padding: 24 }]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
        <Text style={styles.brandTitle}>GLOBAL STATION</Text>
        <Text style={[styles.screenMainTitle, { marginTop: 24 }]}>{registering ? 'Create your account' : 'Sign in'}</Text>
        <Text style={styles.screenSubTitle}>Your account connects to the Global Station service.</Text>
        {registering && <TextInput placeholder="Full name" placeholderTextColor={COLORS.textDim} autoCapitalize="words" value={name} onChangeText={setName} style={styles.flowInput} />}
        <TextInput placeholder="Email" placeholderTextColor={COLORS.textDim} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} style={[styles.flowInput, { marginTop: 14 }]} />
        <TextInput placeholder="Password (at least 8 characters)" placeholderTextColor={COLORS.textDim} secureTextEntry value={password} onChangeText={setPassword} style={[styles.flowInput, { marginTop: 14 }]} />
        {registering && (
          <View style={{ marginTop: 14 }}>
            <Text style={styles.flowLabel}>Account type</Text>
            <View style={styles.heroBtnRow}>
              {(['VIEWER', 'CREATOR', 'ADVERTISER'] as UserRole[]).map((option) => (
                <TouchableOpacity key={option} style={[styles.chip, role === option && styles.chipActive]} onPress={() => setRole(option)}>
                  <Text style={[styles.chipText, role === option && styles.chipTextActive]}>{option === 'VIEWER' ? 'Viewer' : option === 'CREATOR' ? 'Creator' : 'Advertiser'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        {!!error && <Text style={{ color: '#fca5a5', marginTop: 14 }}>{error}</Text>}
        <TouchableOpacity style={[styles.cyanPrimaryBtn, { marginTop: 20 }]} disabled={busy} onPress={submit}>
          <Text style={styles.cyanPrimaryBtnText}>{busy ? (registering ? 'Creating account...' : 'Signing in...') : registering ? 'Create account' : 'Sign in'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ alignItems: 'center', padding: 16 }} onPress={() => { setRegistering(!registering); setError(''); }}>
          <Text style={{ color: COLORS.cyan }}>{registering ? 'Already have an account? Sign in' : 'New to Global Station? Create account'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// --- TAB 1: HOME ---
function PosterImage({ uri, title, style, badge }: { uri?: string; title: string; style: any; badge?: string }) {
  if (!uri) {
    return (
      <View style={[style, styles.posterPlaceholder]}>
        <Text style={styles.placeholderLabel}>{badge ?? title.slice(0, 1).toUpperCase()}</Text>
      </View>
    );
  }

  return <Image source={{ uri }} style={style} resizeMode="cover" />;
}

function HomeTabView({ dramas, continueWatching, loading, error, onRetry, onSelect, onPlay, onContinueWatching, onSearch, onProfile }: { dramas: DramaItem[]; continueWatching: ContinueWatchingItem[]; loading: boolean; error: string | null; onRetry: () => void; onSelect: (d: DramaItem) => void; onPlay: (d: DramaItem) => void; onContinueWatching: (item: ContinueWatchingItem) => void; onSearch: () => void; onProfile: () => void }) {
  const [filter, setFilter] = useState('All');
  const normalizedFilter = filter.trim().toLowerCase();
  const visibleDramas = filter === 'All'
    ? dramas
    : dramas.filter((d) => {
        const categoryMatch = d.category?.toLowerCase().includes(normalizedFilter) || d.genre?.toLowerCase().includes(normalizedFilter);
        return filter === '⭐ VIP' ? d.badge === 'VIP' : categoryMatch;
      });
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 90 }}>
      {/* Brand Header */}
      <View style={styles.brandHeader}>
        <Text style={styles.brandTitle}>GLOBAL STATION</Text>
        <View style={styles.headerRightIcons}>
          <TouchableOpacity onPress={onSearch}><Text style={styles.iconTxt}>⚲</Text></TouchableOpacity>
          <TouchableOpacity onPress={onProfile}><Text style={styles.iconTxt}>👤</Text></TouchableOpacity>
        </View>
      </View>

      {/* Genre Chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {['All', 'Malay Drama', 'Action', '⭐ VIP'].map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.chip, filter === c && styles.chipActive]}
            onPress={() => setFilter(c)}
          >
            <Text style={[styles.chipText, filter === c && styles.chipTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading && <Text style={styles.resultsCount}>Loading catalog...</Text>}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={onRetry}><Text style={styles.seeAllText}>Retry</Text></TouchableOpacity>
        </View>
      )}

      {/* Hero Banner */}
      {dramas[0] && <View style={styles.heroCard}>
        <PosterImage uri={dramas[0].posterUrl} title={dramas[0].title} badge={dramas[0].badge} style={styles.heroPosterImage} />
        <View style={styles.heroGradient}>
          <View style={styles.vipTag}><Text style={styles.vipTagText}>{dramas[0].badge}</Text></View>
          <Text style={styles.heroDramaTitle}>{dramas[0].title}</Text>
          <Text style={styles.heroSub}>{dramas[0].genre} • {dramas[0].rating}</Text>

          <View style={styles.heroBtnRow}>
            <TouchableOpacity style={styles.cyanActionBtn} onPress={() => onPlay(dramas[0])}>
              <Text style={styles.cyanActionBtnText}>▶ Watch Episode 1</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>}

      {/* Continue Watching Rail */}
      {continueWatching.length > 0 && (
        <>
          <Text style={styles.sectionHeaderTitle}>Continue Watching</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railList}>
            {continueWatching.map((item) => (
              <TouchableOpacity key={item.episodeId} style={styles.continueCard} onPress={() => onContinueWatching(item)}>
                <PosterImage uri={item.posterUrl} title={item.title} badge={item.badge} style={styles.continuePosterPlaceholder} />
                <View style={styles.progressTrackSmall}>
                  <View style={[styles.progressBarSmall, { width: `${Math.min(Math.max((item.progress ?? 0) * 100, 0), 100)}%` }]} />
                </View>
                <View style={styles.cardFooterRow}>
                  <Text style={styles.metaSmallText}>{item.title}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}

      {/* Popular Dramas Rail */}
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionHeaderTitle}>Popular Dramas</Text>
        <TouchableOpacity onPress={() => setFilter('All')}><Text style={styles.seeAllText}>See all ›</Text></TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railList}>
        {visibleDramas.filter((d) => !d.progress).map((d) => (
          <TouchableOpacity key={d.id} style={styles.popularCard} onPress={() => onSelect(d)}>
            <PosterImage uri={d.posterUrl} title={d.title} badge={d.badge} style={styles.popularPosterPlaceholder} />
            <View style={d.badge === 'VIP' ? styles.badgeVip : styles.badgeFree}>
              <Text style={styles.badgeText}>{d.badge}</Text>
            </View>
            <Text numberOfLines={2} style={styles.popularCardTitle}>{d.title}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </ScrollView>
  );
}

// --- TAB 2: SEARCH & FILTER ---
function SearchTabView({ dramas, loading, onSelect }: { dramas: DramaItem[]; loading: boolean; onSelect: (d: DramaItem) => void }) {
  const [query, setQuery] = useState('');
  const [selectedPill, setSelectedPill] = useState('All');
  const [results, setResults] = useState<DramaItem[]>(dramas);

  useEffect(() => {
    setResults(dramas);
  }, [dramas]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading) return;
      searchCatalog(query).then(setResults).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, loading]);

  const filtered = results.filter((d) => {
    if (selectedPill === 'All') return true;
    if (selectedPill === 'VIP Only') return d.badge === 'VIP';
    const normalizedPill = selectedPill.trim().toLowerCase();
    const normalizedCategory = (d.category ?? '').trim().toLowerCase();
    const normalizedGenre = (d.genre ?? '').trim().toLowerCase();
    return normalizedCategory.includes(normalizedPill) || normalizedGenre.includes(normalizedPill);
  });

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }}>
      {/* Search Input Bar */}
      <View style={styles.searchBar}>
        <Text style={styles.searchBarIcon}>⚲</Text>
        <TextInput
          placeholder="Search dramas, films, actors..."
          placeholderTextColor={COLORS.textDim}
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
        />
        <Text style={styles.filterIcon}>𝌡</Text>
      </View>

      {/* Filter Chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chipRow, { paddingHorizontal: 0 }]}>
        {['All', 'Action', 'Romance', 'VIP Only'].map((pill) => (
          <TouchableOpacity
            key={pill}
            style={[styles.chip, selectedPill === pill && styles.chipActive]}
            onPress={() => setSelectedPill(pill)}
          >
            <Text style={[styles.chipText, selectedPill === pill && styles.chipTextActive]}>{pill}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={[styles.sectionHeaderTitle, { marginTop: 16 }]}>Search & Filter</Text>
      <Text style={styles.resultsCount}>{filtered.length} Results</Text>

      {/* Drama Search Results List */}
      {filtered.map((d) => (
        <TouchableOpacity key={d.id} style={styles.searchResultCard} onPress={() => onSelect(d)}>
          <PosterImage uri={d.posterUrl} title={d.title} badge={d.badge} style={styles.searchThumbPlaceholder} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.searchResultTitle}>{d.title}</Text>
            <Text style={styles.searchResultMeta}>{d.genre} • {d.rating} {d.tag ? `• ${d.tag}` : ''}</Text>
            <View style={[styles.badgeTagMini, d.badge === 'VIP' ? styles.badgeVip : styles.badgeFree]}>
              <Text style={styles.badgeTextMini}>{d.badge}</Text>
            </View>
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// --- TAB 3: CREATOR STUDIO ---
function CreatorTabView({ creatorName, onUpload }: { creatorName: string; onUpload: () => void }) {
  const [dashboard, setDashboard] = useState<Awaited<ReturnType<typeof getCreatorDashboard>> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutNotice, setPayoutNotice] = useState('');

  async function loadDashboard() {
    setLoading(true);
    setError('');
    try {
      setDashboard(await getCreatorDashboard());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load creator dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadDashboard(); }, []);

  async function submitPayoutRequest() {
    const amount = Number(payoutAmount);
    if (!dashboard || !Number.isFinite(amount) || amount < Number(dashboard.payouts.minimumRequest)) {
      setPayoutNotice(`Enter at least RM ${dashboard?.payouts.minimumRequest ?? '20.00'}.`);
      return;
    }
    setPayoutBusy(true);
    setPayoutNotice('');
    try {
      await requestCreatorPayout(amount);
      setPayoutAmount('');
      setPayoutNotice('Payout request submitted for review.');
      await loadDashboard();
    } catch (requestError) {
      setPayoutNotice(requestError instanceof Error ? requestError.message : 'Unable to request payout.');
    } finally {
      setPayoutBusy(false);
    }
  }

  function confirmArchive(submission: NonNullable<typeof dashboard>['submissions'][number]) {
    const archived = !submission.isArchived;
    Alert.alert(archived ? 'Archive video?' : 'Restore video?', archived ? 'This video will be hidden from viewers but can be restored later.' : 'This video will return to its previous publication status.', [
      { text: 'Cancel', style: 'cancel' },
      { text: archived ? 'Archive' : 'Restore', onPress: async () => {
        try { await archiveCreatorContent(submission.id, archived); await loadDashboard(); }
        catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to update video.'); }
      } },
    ]);
  }

  function confirmDelete(submission: NonNullable<typeof dashboard>['submissions'][number]) {
    Alert.alert('Delete video permanently?', `“${submission.title}”, its poster, episodes and statistics will be deleted. This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete permanently', style: 'destructive', onPress: async () => {
        try { await deleteCreatorContent(submission.id); await loadDashboard(); }
        catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to delete video.'); }
      } },
    ]);
  }

  const submissions = dashboard?.submissions ?? [];
  const totalViews = submissions.reduce((total, item) => total + item.views, 0);
  const totalWatchHours = submissions.reduce((total, item) => total + item.watchSeconds, 0) / 3600;
  const publishedCount = submissions.filter(item => item.status === 'APPROVED').length;

  return <ScrollView contentContainerStyle={styles.creatorPage}>
    <View style={styles.creatorPageHeading}>
      <View><Text style={styles.screenMainTitle}>Creator Studio</Text><Text style={styles.screenSubTitle}>{creatorName}</Text></View>
      <TouchableOpacity style={styles.uploadBtn} onPress={onUpload}><Text style={styles.uploadBtnText}>+ Upload content</Text></TouchableOpacity>
    </View>
    <View style={styles.creatorKpiGrid}>
      <View style={styles.creatorKpiCard}><Text style={styles.creatorKpiLabel}>Total plays</Text><Text style={styles.creatorKpiValue}>{totalViews.toLocaleString()}</Text><Text style={styles.creatorKpiFootnote}>Across your videos</Text></View>
      <View style={styles.creatorKpiCard}><Text style={styles.creatorKpiLabel}>Watch time</Text><Text style={styles.creatorKpiValue}>{totalWatchHours.toFixed(1)} h</Text><Text style={styles.creatorKpiFootnote}>Total viewer time</Text></View>
      <View style={styles.creatorKpiCard}><Text style={styles.creatorKpiLabel}>Published</Text><Text style={styles.creatorKpiValue}>{publishedCount}</Text><Text style={styles.creatorKpiFootnote}>Approved titles</Text></View>
      <View style={styles.creatorKpiCard}><Text style={styles.creatorKpiLabel}>Available payout</Text><Text style={styles.creatorKpiValue}>RM {Number(dashboard?.payouts.available ?? 0).toFixed(2)}</Text><Text style={styles.creatorKpiFootnote}>Earned RM {Number(dashboard?.payouts.earned ?? 0).toFixed(2)}</Text></View>
    </View>

    <View style={styles.creatorSectionHeading}><View><Text style={styles.screenMainTitle}>Your videos</Text><Text style={styles.screenSubTitle}>{submissions.length} submissions</Text></View><TouchableOpacity style={styles.secondaryFlowBtn} disabled={loading} onPress={loadDashboard}><Text style={styles.secondaryFlowText}>{loading ? 'Refreshing…' : 'Refresh'}</Text></TouchableOpacity></View>
    {loading && <Text style={styles.creatorEmpty}>Loading creator data…</Text>}
    {!!error && <Text style={styles.errorText}>{error}</Text>}
    {!loading && !error && submissions.length === 0 && <Text style={styles.creatorEmpty}>Your submitted videos will appear here.</Text>}
    {submissions.map((submission) => <View key={submission.id} style={styles.creatorContentCard}>
      <View style={styles.creatorContentHeader}>
        {submission.posterUrl ? <Image source={{ uri: submission.posterUrl }} style={styles.creatorPoster} resizeMode="cover" /> : <View style={[styles.creatorPoster, styles.posterPlaceholder]}><Text style={styles.placeholderLabel}>{submission.title.slice(0, 1)}</Text></View>}
        <View style={styles.creatorContentInfo}>
          <Text style={styles.pipelineTitle}>{submission.title}</Text>
          <Text style={styles.creatorMeta}>{submission.contentType} · {submission.category} · {submission.genre} · {submission.rating}</Text>
          <Text style={styles.pipelineSub}>{submission.episodeCount} episode(s) · Submitted {new Date(submission.createdAt).toLocaleDateString()}</Text>
          <Text style={submission.isArchived ? styles.creatorStatusPending : submission.status === 'APPROVED' ? styles.creatorStatusApproved : submission.status === 'REJECTED' ? styles.creatorStatusRejected : styles.creatorStatusPending}>{submission.isArchived ? 'ARCHIVED' : submission.status.replace('_', ' ')}</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" onPress={() => setExpandedId(expandedId === submission.id ? null : submission.id)}><Text style={styles.creatorDetailsAction}>{expandedId === submission.id ? 'Hide details' : 'Details'}</Text></TouchableOpacity>
      </View>
      <View style={styles.creatorStatsRow}>
        <View style={styles.creatorStatCell}><Text style={styles.creatorKpiLabel}>Plays</Text><Text style={styles.creatorStatValue}>{submission.views.toLocaleString()}</Text></View>
        <View style={styles.creatorStatCell}><Text style={styles.creatorKpiLabel}>Viewers</Text><Text style={styles.creatorStatValue}>{submission.uniqueViewers.toLocaleString()}</Text></View>
        <View style={styles.creatorStatCell}><Text style={styles.creatorKpiLabel}>Watch time</Text><Text style={styles.creatorStatValue}>{(submission.watchSeconds / 3600).toFixed(1)} h</Text></View>
      </View>
      {expandedId === submission.id && <View style={styles.creatorDetails}>
        <Text style={styles.creatorDetailsHeading}>Synopsis</Text><Text style={styles.creatorDetailText}>{submission.description || 'No synopsis.'}</Text>
        <Text style={styles.creatorDetailsHeading}>Episode performance</Text>
        {submission.episodes.map(episode => <View key={episode.episodeNumber} style={styles.creatorEpisodeRow}><Text style={styles.creatorDetailText}>EP {episode.episodeNumber} · {episode.title} · {Math.round(episode.durationSeconds / 60)} min</Text><Text style={styles.creatorDetailText}>{episode.views} plays · {(episode.watchSeconds / 3600).toFixed(1)} h</Text></View>)}
      </View>}
      <View style={styles.creatorContentActions}>
        <TouchableOpacity disabled={loading} onPress={() => confirmArchive(submission)}><Text style={styles.creatorDetailsAction}>{submission.isArchived ? 'Restore' : 'Archive'}</Text></TouchableOpacity>
        <TouchableOpacity disabled={loading} onPress={() => confirmDelete(submission)}><Text style={styles.creatorDeleteAction}>Delete permanently</Text></TouchableOpacity>
      </View>
    </View>)}

    <View style={styles.creatorPayoutCard}>
      <View style={styles.creatorSectionHeading}><View><Text style={styles.screenMainTitle}>Payouts</Text><Text style={styles.screenSubTitle}>Request a transfer of available creator earnings.</Text></View><Text style={styles.creatorPayoutAvailable}>RM {Number(dashboard?.payouts.available ?? 0).toFixed(2)}</Text></View>
      <View style={styles.creatorPayoutForm}><TextInput value={payoutAmount} onChangeText={setPayoutAmount} editable={!payoutBusy} keyboardType="decimal-pad" placeholder={`Minimum RM ${dashboard?.payouts.minimumRequest ?? '20.00'}`} placeholderTextColor={COLORS.textDim} style={styles.creatorPayoutInput} /><TouchableOpacity style={styles.uploadBtn} disabled={payoutBusy || loading} onPress={submitPayoutRequest}><Text style={styles.uploadBtnText}>{payoutBusy ? 'Requesting…' : 'Request payout'}</Text></TouchableOpacity></View>
      {!!payoutNotice && <Text style={styles.screenSubTitle}>{payoutNotice}</Text>}
      {(dashboard?.payouts.requests ?? []).slice(0, 5).map(request => <View key={request.id} style={styles.creatorPayoutRow}><Text style={styles.creatorDetailText}>{new Date(request.requestedAt).toLocaleDateString()} · RM {Number(request.amount).toFixed(2)}</Text><Text style={styles.creatorMeta}>{request.status}</Text></View>)}
    </View>
  </ScrollView>;
}

// --- TAB 4: ADVERTISER HUB ---
function AdsTabView({ onCampaign }: { onCampaign: () => void }) {
  const [campaigns, setCampaigns] = useState<Awaited<ReturnType<typeof listAdvertiserCampaigns>>>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadCampaigns() {
    setLoading(true);
    setError('');
    try {
      setCampaigns(await listAdvertiserCampaigns());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load campaigns.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCampaigns(); }, []);
  const activeCampaigns = campaigns.filter(campaign => campaign.status === 'ACTIVE');
  const remaining = campaigns.reduce((sum, campaign) => sum + Number(campaign.remainingBudget), 0);
  const totalBudget = campaigns.reduce((sum, campaign) => sum + Number(campaign.totalBudget), 0);
  const impressions = campaigns.reduce((sum, campaign) => sum + campaign.impressions, 0);

  return (
    <ScrollView contentContainerStyle={styles.advertiserPage}>
      <View style={styles.advertiserHeader}>
        <View><Text style={styles.screenMainTitle}>Advertiser campaigns</Text><Text style={styles.screenSubTitle}>Budget and delivery at a glance</Text></View>
        <View style={styles.advertiserHeaderActions}>
          <TouchableOpacity style={styles.advertiserRefresh} disabled={loading} onPress={loadCampaigns}><Text style={styles.secondaryFlowText}>{loading ? 'Refreshing…' : 'Refresh'}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.uploadBtn} onPress={onCampaign}><Text style={styles.uploadBtnText}>+ New campaign</Text></TouchableOpacity>
        </View>
      </View>
      <View style={styles.advertiserSummaryGrid}>
        <View style={styles.advertiserSummaryCard}><Text style={styles.advertiserSummaryLabel}>Active campaigns</Text><Text style={styles.advertiserSummaryValue}>{activeCampaigns.length}</Text></View>
        <View style={styles.advertiserSummaryCard}><Text style={styles.advertiserSummaryLabel}>Budget remaining</Text><Text style={styles.advertiserSummaryValue}>RM {remaining.toFixed(2)}</Text></View>
        <View style={styles.advertiserSummaryCard}><Text style={styles.advertiserSummaryLabel}>Total allocated</Text><Text style={styles.advertiserSummaryValue}>RM {totalBudget.toFixed(2)}</Text></View>
        <View style={styles.advertiserSummaryCard}><Text style={styles.advertiserSummaryLabel}>Impressions served</Text><Text style={styles.advertiserSummaryValue}>{impressions.toLocaleString()}</Text></View>
      </View>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
      {!loading && !error && campaigns.length === 0 && <View style={styles.advertiserEmpty}><Text style={styles.screenMainTitle}>No campaigns yet</Text><Text style={styles.screenSubTitle}>Create a campaign to preview its reach and track delivery.</Text><TouchableOpacity style={[styles.uploadBtn, { marginTop: 16 }]} onPress={onCampaign}><Text style={styles.uploadBtnText}>Create campaign</Text></TouchableOpacity></View>}
      {campaigns.map(campaign => {
        const budget = Number(campaign.totalBudget);
        const remainingBudget = Number(campaign.remainingBudget);
        const spent = Math.max(0, budget - remainingBudget);
        const spendPercent = budget > 0 ? Math.min(100, spent / budget * 100) : 0;
        const estimatedRemaining = Number(campaign.cpmRate) > 0 ? Math.floor(remainingBudget / Number(campaign.cpmRate) * 1000) : 0;
        return <View key={campaign.id} style={styles.advertiserCampaignCard}>
          <View style={styles.advertiserCampaignHeading}><View style={{ flex: 1 }}><Text style={styles.campaignTitle}>{campaign.campaignName}</Text><Text style={styles.campaignSub}>Audience · {campaign.targetTier === 'ALL' ? 'All viewers' : campaign.targetTier === 'VIP' ? 'VIP members' : 'Free viewers'}</Text></View><Text style={campaign.status === 'ACTIVE' ? styles.advertiserStatusActive : styles.advertiserStatusPaused}>{campaign.status}</Text></View>
          <View style={styles.advertiserBudgetHeading}><Text style={styles.advertiserBudgetMain}>RM {remainingBudget.toFixed(2)} <Text style={styles.advertiserBudgetMinor}>remaining</Text></Text><Text style={styles.advertiserBudgetTotal}>of RM {budget.toFixed(2)}</Text></View>
          <View style={styles.advertiserBudgetTrack}><View style={[styles.advertiserBudgetFill, { width: `${spendPercent}%` }]} /></View>
          <View style={styles.advertiserCampaignStats}>
            <View><Text style={styles.advertiserSummaryLabel}>Spent</Text><Text style={styles.advertiserCampaignStatValue}>RM {spent.toFixed(2)}</Text></View>
            <View><Text style={styles.advertiserSummaryLabel}>CPM</Text><Text style={styles.advertiserCampaignStatValue}>RM {Number(campaign.cpmRate).toFixed(2)}</Text></View>
            <View><Text style={styles.advertiserSummaryLabel}>Served</Text><Text style={styles.advertiserCampaignStatValue}>{campaign.impressions.toLocaleString()}</Text></View>
            <View><Text style={styles.advertiserSummaryLabel}>Est. remaining</Text><Text style={styles.advertiserCampaignStatValue}>{estimatedRemaining.toLocaleString()}</Text></View>
          </View>
        </View>;
      })}
    </ScrollView>
  );
}

// --- TAB 5: PROFILE & VIP SUBSCRIPTION ---
function ProfileTabView({ profile, onSupport, onRefreshProfile, onUpgradeRole, onSignOut }: { profile: ViewerProfile; onSupport: () => void; onRefreshProfile: () => Promise<void>; onUpgradeRole: (role: 'CREATOR' | 'ADVERTISER') => Promise<void>; onSignOut: () => void }) {
  const roles = profile.roles?.length ? profile.roles : [profile.role];
  const missingRoles = profile.role === 'ADMIN' ? [] : (['CREATOR', 'ADVERTISER'] as const).filter(role => !roles.includes(role));
  const [subscription, setSubscription] = useState<Awaited<ReturnType<typeof getCurrentSubscription>>>(null);
  const [message, setMessage] = useState('');
  const [busyPlan, setBusyPlan] = useState<'VIP_MONTHLY' | 'VIP_YEARLY' | null>(null);
  const [busyUpgrade, setBusyUpgrade] = useState<'CREATOR' | 'ADVERTISER' | null>(null);

  async function upgradeRole(role: 'CREATOR' | 'ADVERTISER') {
    setBusyUpgrade(role);
    setMessage('');
    try {
      await onUpgradeRole(role);
      setMessage(role === 'CREATOR' ? 'Your account is now registered as a content creator.' : 'Your account is now registered as an advertiser.');
      await onRefreshProfile();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update your account type.');
    } finally {
      setBusyUpgrade(null);
    }
  }

  async function refreshMembership() {
    try {
      setSubscription(await getCurrentSubscription());
      await onRefreshProfile();
      setMessage('Membership status refreshed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to refresh membership.');
    }
  }

  async function beginCheckout(plan: 'VIP_MONTHLY' | 'VIP_YEARLY') {
    setBusyPlan(plan);
    setMessage('');
    try {
      const checkout = await createVipCheckout(plan);
      await Linking.openURL(checkout.paymentUrl);
      setMessage('Complete payment in Billplz, return here, then refresh membership status.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to start checkout.');
    } finally {
      setBusyPlan(null);
    }
  }

  useEffect(() => {
    getCurrentSubscription().then(setSubscription).catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to load membership.'));
  }, []);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }}>
      <View style={styles.profileUserRow}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarLetter}>{profile.name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ marginLeft: 14 }}>
          <Text style={styles.profileName}>{profile.name}</Text>
          <Text style={styles.profileEmail}>{profile.email}</Text>
        </View>
      </View>

      <View style={styles.metricCard}>
        <Text style={styles.metricCardLabel}>Membership</Text>
        <Text style={styles.metricBigAmount}>{profile.isVip ? 'VIP' : 'Free'}</Text>
        <Text style={styles.metricSubInfo}>{subscription ? `${subscription.planCode.replace('_', ' ')} • ${subscription.status}` : 'No subscription record'}</Text>
        {subscription?.renewsAt && <Text style={styles.metricSubInfo}>Renews {new Date(subscription.renewsAt).toLocaleDateString()}</Text>}
      </View>

      {missingRoles.length > 0 ? (
        <View style={[styles.metricCard, { marginTop: 20 }]}>
          <Text style={styles.metricCardLabel}>Add an account role</Text>
          {missingRoles.includes('CREATOR') && <TouchableOpacity style={[styles.planCard, { marginTop: 12 }]} disabled={busyUpgrade !== null} onPress={() => upgradeRole('CREATOR')}>
            <View style={{ flex: 1 }}><Text style={styles.planTitle}>Content Creator</Text><Text style={styles.planSub}>Upload videos and track performance</Text></View>
            <Text style={styles.planPrice}>{busyUpgrade === 'CREATOR' ? 'Adding...' : 'Add role'}</Text>
          </TouchableOpacity>}
          {missingRoles.includes('ADVERTISER') && <TouchableOpacity style={[styles.planCard, { marginTop: 10 }]} disabled={busyUpgrade !== null} onPress={() => upgradeRole('ADVERTISER')}>
            <View style={{ flex: 1 }}><Text style={styles.planTitle}>Advertiser</Text><Text style={styles.planSub}>Launch campaigns and sponsored ads</Text></View>
            <Text style={styles.planPrice}>{busyUpgrade === 'ADVERTISER' ? 'Adding...' : 'Add role'}</Text>
          </TouchableOpacity>}
        </View>
      ) : (
        <View style={[styles.metricCard, { marginTop: 20 }]}>
          <Text style={styles.metricCardLabel}>Account roles</Text>
          <Text style={styles.metricBigAmount}>{roles.filter(role => role !== 'VIEWER').join(' + ') || 'Viewer'}</Text>
          <Text style={styles.metricSubInfo}>All role workspaces are available from the app navigation.</Text>
        </View>
      )}

      <Text style={[styles.sectionHeaderTitle, { marginTop: 22 }]}>VIP membership</Text>
      <TouchableOpacity style={styles.planCard} disabled={busyPlan !== null} onPress={() => beginCheckout('VIP_MONTHLY')}>
        <View style={{ flex: 1 }}><Text style={styles.planTitle}>Monthly</Text><Text style={styles.planSub}>Billplz checkout</Text></View>
        <Text style={styles.planPrice}>RM 14.90</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.planCard} disabled={busyPlan !== null} onPress={() => beginCheckout('VIP_YEARLY')}>
        <View style={{ flex: 1 }}><Text style={styles.planTitle}>Annual</Text><Text style={styles.planSub}>Billplz checkout</Text></View>
        <Text style={styles.planPrice}>RM 119.90</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryFlowBtn} disabled={busyPlan !== null} onPress={refreshMembership}>
        <Text style={styles.secondaryFlowText}>{busyPlan ? 'Opening checkout...' : 'Refresh membership status'}</Text>
      </TouchableOpacity>
      {!!message && <Text style={[styles.screenSubTitle, { marginTop: 12 }]}>{message}</Text>}
      <TouchableOpacity style={[styles.secondaryFlowBtn, { marginTop: 18 }]} onPress={onSupport}>
        <Text style={styles.secondaryFlowText}>Contact support</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.secondaryFlowBtn, { marginTop: 24 }]} onPress={onSignOut}>
        <Text style={styles.secondaryFlowText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function FlowHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return <View style={styles.flowHeader}><TouchableOpacity onPress={onBack}><Text style={styles.backBtnText}>‹ Back</Text></TouchableOpacity><Text style={styles.flowHeaderTitle}>{title}</Text><View style={{ width: 48 }} /></View>;
}

function FlowField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return <View style={styles.flowField}><Text style={styles.flowLabel}>{label}</Text><TextInput value={value} editable={false} multiline={multiline} style={[styles.flowInput, multiline && styles.flowTextArea]} placeholderTextColor={COLORS.textDim} /></View>;
}

function AdBreak({ onComplete }: { onComplete: () => void }) {
  const [ad, setAd] = useState<AdPayload | null>(null);
  const [secondsUntilSkip, setSecondsUntilSkip] = useState(5);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let active = true;
    getAdPayload().then((payload) => {
      if (!active) return;
      if (!payload) onCompleteRef.current();
      else setAd(payload);
    }).catch(() => active && onCompleteRef.current());
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ad || secondsUntilSkip <= 0) return;
    const timer = setTimeout(() => setSecondsUntilSkip((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [ad, secondsUntilSkip]);

  if (!ad) return <View pointerEvents="none" style={StyleSheet.absoluteFill} />;
  return <View style={StyleSheet.absoluteFill}>
    <Video source={{ uri: ad.creativeVideoUrl }} paused={false} controls={false} resizeMode="contain" style={StyleSheet.absoluteFill} onEnd={onComplete} onError={onComplete} />
    <View style={[styles.adCard, { position: 'absolute', left: 16, right: 16, bottom: 16 }]}>
      <View style={styles.adHeaderRow}><View style={styles.daiBadge}><Text style={styles.daiBadgeText}>SPONSORED</Text></View><Text style={styles.adRemaining}>{secondsUntilSkip > 0 ? `Skip in ${secondsUntilSkip}s` : 'Ad'}</Text></View>
      <Text style={styles.adTitle}>{ad.title}</Text>
      <View style={styles.adActionRow}>
        {ad.clickThroughUrl && <TouchableOpacity onPress={() => Linking.openURL(ad.clickThroughUrl!).catch(() => Alert.alert('Unable to open link', 'The advertiser link could not be opened.'))}><Text style={styles.learnMoreText}>Visit advertiser</Text></TouchableOpacity>}
        {secondsUntilSkip === 0 && <TouchableOpacity style={styles.skipBtn} onPress={onComplete}><Text style={styles.skipBtnText}>Skip ad</Text></TouchableOpacity>}
      </View>
    </View>
  </View>;
}

function PayoutScreen({ onBack }: { onBack: () => void }) {
  return <View style={styles.flowScreen}><FlowHeader title="Payout Gateway" onBack={onBack} /><ScrollView contentContainerStyle={styles.flowContent}>
    <Text style={styles.screenMainTitle}>Payout Gateway</Text><Text style={styles.screenSubTitle}>Withdraw your creator earnings</Text>
    <View style={styles.flowMetric}><Text style={styles.metricCardLabel}>Available balance</Text><Text style={styles.metricBigAmount}>$3,700.00</Text><Text style={styles.metricSubInfo}>Next payout: 15 Aug 2026</Text></View>
    <FlowField label="Payout method" value="Maybank •••• 2048" /><FlowField label="Payout amount" value="$3,700.00" /><FlowField label="Payout note" value="Monthly creator earnings" />
    <TouchableOpacity style={styles.cyanPrimaryBtn} onPress={() => Alert.alert('Payout requested', 'Your payout is now being processed.')}><Text style={styles.cyanPrimaryBtnText}>Confirm $3,700.00 Payout</Text></TouchableOpacity>
  </ScrollView></View>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  const [visible, setVisible] = useState(false);
  return <View style={styles.flowField}>
    <Text style={styles.flowLabel}>{label}</Text>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} style={styles.selectField} onPress={() => setVisible(true)}>
      <Text style={styles.selectValue}>{value}</Text><Text style={styles.selectChevron}>⌄</Text>
    </TouchableOpacity>
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={styles.selectModalBackdrop}>
        <View style={styles.selectModal}>
          <Text style={styles.selectModalTitle}>{label}</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {options.map((option) => <TouchableOpacity key={option} style={styles.selectOption} onPress={() => { onChange(option); setVisible(false); }}>
              <Text style={[styles.selectOptionText, option === value && styles.selectOptionTextSelected]}>{option}</Text>
              {option === value && <Text style={styles.selectCheck}>✓</Text>}
            </TouchableOpacity>)}
          </ScrollView>
          <TouchableOpacity style={styles.secondaryFlowBtn} onPress={() => setVisible(false)}><Text style={styles.secondaryFlowText}>Cancel</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  </View>;
}

function UploadScreen({ onBack }: { onBack: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState('Drama');
  const [category, setCategory] = useState('Malay Drama');
  const [rating, setRating] = useState('P13');
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [durationSeconds, setDurationSeconds] = useState('');
  const [contentType, setContentType] = useState<'MOVIE' | 'SERIES'>('SERIES');
  const [isExclusiveVip, setIsExclusiveVip] = useState(false);
  const [video, setVideo] = useState<{ path: string; name: string; size: number } | null>(null);
  const [poster, setPoster] = useState<{ path: string; name: string; size: number; contentType: string } | null>(null);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function chooseVideo() {
    setNotice('');
    try {
      const [picked] = await pick({ type: [types.video], mode: 'import' });
      if (!picked.name || !picked.size || picked.type !== 'video/mp4' || !picked.name.toLowerCase().endsWith('.mp4')) {
        throw new Error('Choose a non-empty MP4 video file.');
      }
      const [copy] = await keepLocalCopy({ files: [{ uri: picked.uri, fileName: picked.name }], destination: 'cachesDirectory' });
      if (copy.status !== 'success') throw new Error(copy.copyError || 'Unable to access the selected video.');
      setVideo({ path: copy.localUri.replace(/^file:\/\//, ''), name: picked.name, size: picked.size });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to select video.');
    }
  }

  async function choosePoster() {
    setNotice('');
    try {
      const [picked] = await pick({ type: [types.images], mode: 'import' });
      const name = picked.name?.trim() || decodeURIComponent(picked.uri.split('/').pop()?.split('?')[0] ?? 'poster');
      const extension = name.toLowerCase().split('.').pop();
      const extensionTypes: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
      const reportedType = picked.type?.toLowerCase() === 'image/jpg' ? 'image/jpeg' : picked.type?.toLowerCase();
      const contentType = reportedType && ['image/jpeg', 'image/png', 'image/webp'].includes(reportedType)
        ? reportedType
        : extensionTypes[extension ?? ''];
      if (!contentType) {
        throw new Error('Choose a JPEG, PNG, or WebP poster image.');
      }
      const [copy] = await keepLocalCopy({ files: [{ uri: picked.uri, fileName: name }], destination: 'cachesDirectory' });
      if (copy.status !== 'success') throw new Error(copy.copyError || 'Unable to access the selected poster.');
      const path = copy.localUri.replace(/^file:\/\//, '');
      const file = await ReactNativeBlobUtil.fs.stat(path);
      const size = picked.size && picked.size > 0 ? picked.size : Number(file.size);
      if (!Number.isSafeInteger(size) || size < 1) throw new Error('The selected poster file is empty or unreadable.');
      if (size > 10 * 1024 * 1024) throw new Error('Poster images must be 10 MB or smaller.');
      setPoster({ path, name, size, contentType });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to select poster image.');
    }
  }

  async function submit() {
    if (!video || !poster) { setNotice('Select both an MP4 video and a poster image first.'); return; }
    if (!title.trim() || !description.trim() || !genre || !category || (contentType === 'SERIES' && !episodeTitle.trim()) || !Number.isSafeInteger(Number(durationSeconds)) || Number(durationSeconds) <= 0) {
      setNotice('Complete all content details before submitting.');
      return;
    }
    setBusy(true);
    setNotice('');
    setProgress(0);
    try {
      const posterUpload = await createCreatorPosterUpload(poster.contentType, poster.size);
      const posterResult = await ReactNativeBlobUtil.fetch('PUT', posterUpload.uploadUrl, { 'Content-Type': posterUpload.contentType, ...posterUpload.requiredHeaders }, ReactNativeBlobUtil.wrap(poster.path))
        .uploadProgress({ interval: 500 }, (written, total) => setProgress(Math.min(15, Math.round(written / Math.max(1, total) * 15))));
      if (posterResult.info().status < 200 || posterResult.info().status >= 300) throw new Error(`Poster upload failed (${posterResult.info().status}).`);

      const upload = await createCreatorUpload(video.size);
      const result = await ReactNativeBlobUtil.fetch('PUT', upload.uploadUrl, { 'Content-Type': upload.contentType }, ReactNativeBlobUtil.wrap(video.path))
        .uploadProgress({ interval: 500 }, (written, total) => setProgress(Math.min(100, 15 + Math.round(written / Math.max(1, total) * 85))));
      if (result.info().status < 200 || result.info().status >= 300) throw new Error(`Video upload failed (${result.info().status}).`);
      await submitCreatorContent({ title: title.trim(), contentType, description: description.trim(), posterKey: posterUpload.objectKey, rating, genre, category, episodeTitle: contentType === 'MOVIE' ? title.trim() : episodeTitle.trim(), durationSeconds: Number(durationSeconds), mediaKey: upload.objectKey, isExclusiveVip });
      Alert.alert('Submission received', 'Your video and metadata were saved for content review.');
      onBack();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to upload this submission.');
    } finally {
      setBusy(false);
    }
  }

  return <View style={styles.flowScreen}><FlowHeader title="Upload content" onBack={onBack} /><ScrollView contentContainerStyle={styles.flowContent}>
    <Text style={styles.screenMainTitle}>Submit a video</Text>
    <Text style={styles.screenSubTitle}>Submit an MP4 and poster image. Content is reviewed before it appears in the catalog.</Text>
    <TouchableOpacity style={styles.secondaryFlowBtn} disabled={busy} onPress={chooseVideo}><Text style={styles.secondaryFlowText}>{video ? `${video.name} • ${(video.size / 1048576).toFixed(1)} MB` : 'Choose MP4 video'}</Text></TouchableOpacity>
    <TouchableOpacity style={styles.secondaryFlowBtn} disabled={busy} onPress={choosePoster}><Text style={styles.secondaryFlowText}>{poster ? `${poster.name} • ${(poster.size / 1048576).toFixed(1)} MB` : 'Choose poster (JPEG, PNG, WebP; max 10 MB)'}</Text></TouchableOpacity>
    <View style={styles.heroBtnRow}>{(['SERIES', 'MOVIE'] as const).map((type) => <TouchableOpacity key={type} disabled={busy} style={[styles.chip, contentType === type && styles.chipActive]} onPress={() => setContentType(type)}><Text style={[styles.chipText, contentType === type && styles.chipTextActive]}>{type}</Text></TouchableOpacity>)}</View>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Title</Text><TextInput value={title} onChangeText={setTitle} editable={!busy} maxLength={255} style={styles.flowInput} /></View>
    {contentType === 'SERIES' && <View style={styles.flowField}><Text style={styles.flowLabel}>First episode title</Text><TextInput value={episodeTitle} onChangeText={setEpisodeTitle} editable={!busy} maxLength={255} style={styles.flowInput} /></View>}
    <View style={styles.flowField}><Text style={styles.flowLabel}>Synopsis</Text><TextInput value={description} onChangeText={setDescription} editable={!busy} maxLength={5000} style={[styles.flowInput, styles.flowTextArea]} multiline textAlignVertical="top" /></View>
    <SelectField label="Genre" value={genre} options={['Action', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Horror', 'Romance', 'Science Fiction', 'Thriller']} onChange={setGenre} />
    <SelectField label="Category" value={category} options={['Documentary', 'Film', 'Malay Drama', 'Original Series', 'Korean Drama', 'Variety']} onChange={setCategory} />
    <SelectField label="Rating" value={rating} options={['U', 'P12', 'P13', '16', '18']} onChange={setRating} />
    <View style={styles.flowField}><Text style={styles.flowLabel}>Duration (seconds)</Text><TextInput value={durationSeconds} onChangeText={setDurationSeconds} editable={!busy} style={styles.flowInput} keyboardType="number-pad" /></View>
    <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: isExclusiveVip }} style={styles.secondaryFlowBtn} disabled={busy} onPress={() => setIsExclusiveVip(!isExclusiveVip)}><Text style={styles.secondaryFlowText}>{isExclusiveVip ? '☑ VIP exclusive' : '☐ VIP exclusive'}</Text></TouchableOpacity>
    {busy && <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={styles.uploadProgress}><View style={[styles.uploadProgressFill, { width: `${progress}%` }]} /></View>}
    {busy && <Text style={styles.screenSubTitle}>Uploading poster and video: {progress}%</Text>}
    {!!notice && <Text style={[styles.screenSubTitle, { marginTop: 12 }]}>{notice}</Text>}
    <TouchableOpacity style={styles.cyanPrimaryBtn} disabled={busy} onPress={submit}><Text style={styles.cyanPrimaryBtnText}>{busy ? 'Uploading...' : 'Upload and submit for review'}</Text></TouchableOpacity>
  </ScrollView></View>;
}

function CampaignScreen({ onBack }: { onBack: () => void }) {
  const [campaignName, setCampaignName] = useState('Brand awareness');
  const [clickThroughUrl, setClickThroughUrl] = useState('');
  const [cpmRate, setCpmRate] = useState(10);
  const [totalBudget, setTotalBudget] = useState(500);
  const [targetTier, setTargetTier] = useState<'ALL' | 'FREE' | 'VIP'>('ALL');
  const [creative, setCreative] = useState<{ path: string; name: string; size: number } | null>(null);
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  async function chooseCreative() {
    setNotice('');
    try {
      const [picked] = await pick({ type: [types.video], mode: 'import' });
      if (!picked.name || !picked.size || picked.type !== 'video/mp4' || !picked.name.toLowerCase().endsWith('.mp4')) {
        throw new Error('Choose an MP4 campaign video.');
      }
      const [copy] = await keepLocalCopy({ files: [{ uri: picked.uri, fileName: picked.name }], destination: 'cachesDirectory' });
      if (copy.status !== 'success') throw new Error(copy.copyError || 'Unable to access the selected MP4.');
      setCreative({ path: copy.localUri.replace(/^file:\/\//, ''), name: picked.name, size: picked.size });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to select campaign video.');
    }
  }

  async function submit() {
    if (!creative) { setNotice('Choose an MP4 campaign video first.'); return; }
    if (!clickThroughUrl.trim().startsWith('https://')) { setNotice('Enter a secure HTTPS destination URL.'); return; }
    setBusy(true);
    setNotice('');
    setProgress(0);
    try {
      const upload = await createAdvertiserUpload(creative.size);
      const result = await ReactNativeBlobUtil.fetch('PUT', upload.uploadUrl, { 'Content-Type': upload.contentType }, ReactNativeBlobUtil.wrap(creative.path))
        .uploadProgress({ interval: 500 }, (written, total) => setProgress(Math.min(100, Math.round(written / Math.max(1, total) * 100))));
      if (result.info().status < 200 || result.info().status >= 300) throw new Error(`Creative upload failed (${result.info().status}).`);
      await createAdvertiserCampaign({ campaignName, creativeKey: upload.objectKey, clickThroughUrl: clickThroughUrl.trim(), cpmRate, totalBudget, targetTier });
      Alert.alert('Campaign submitted', `Estimated delivery: ${Math.floor(totalBudget / cpmRate * 1000).toLocaleString()} impressions. An administrator will review and activate it.`);
      onBack();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to submit campaign.');
    } finally {
      setBusy(false);
    }
  }

  const estimatedImpressions = Math.floor(totalBudget / cpmRate * 1000);
  return <View style={styles.flowScreen}><FlowHeader title="New campaign" onBack={onBack} /><ScrollView contentContainerStyle={styles.flowContent}>
    <Text style={styles.screenMainTitle}>Plan your campaign</Text>
    <SelectField label="Campaign goal" value={campaignName} options={['Brand awareness', 'Product launch', 'App installs', 'Seasonal offer']} onChange={setCampaignName} />
    <View style={styles.flowField}><Text style={styles.flowLabel}>Video creative</Text><TouchableOpacity style={styles.creativePicker} disabled={busy} onPress={chooseCreative}><Text style={styles.creativePickerIcon}>▶</Text><View style={{ flex: 1 }}><Text style={styles.creativePickerTitle}>{creative?.name ?? 'Choose MP4 video'}</Text><Text style={styles.creativePickerSub}>{creative ? `${(creative.size / 1048576).toFixed(1)} MB` : 'Upload a video ad from this device'}</Text></View><Text style={styles.creativePickerAction}>{creative ? 'Change' : 'Browse'}</Text></TouchableOpacity></View>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Destination link</Text><TextInput value={clickThroughUrl} onChangeText={setClickThroughUrl} editable={!busy} autoCapitalize="none" keyboardType="url" placeholder="https://your-site.com" placeholderTextColor={COLORS.textDim} style={styles.flowInput} /></View>
    <View style={styles.campaignChoiceSection}><Text style={styles.flowLabel}>Audience</Text><View style={styles.campaignChoiceRow}>{(['ALL', 'FREE', 'VIP'] as const).map(tier => <TouchableOpacity key={tier} disabled={busy} style={[styles.campaignChoice, targetTier === tier && styles.campaignChoiceActive]} onPress={() => setTargetTier(tier)}><Text style={[styles.campaignChoiceLabel, targetTier === tier && styles.campaignChoiceLabelActive]}>{tier === 'ALL' ? 'Everyone' : tier === 'FREE' ? 'Free' : 'VIP'}</Text></TouchableOpacity>)}</View></View>
    <View style={styles.campaignChoiceSection}><Text style={styles.flowLabel}>CPM · cost per 1,000 impressions</Text><View style={styles.campaignChoiceRow}>{[5, 10, 20, 30].map(rate => <TouchableOpacity key={rate} disabled={busy} style={[styles.campaignChoice, cpmRate === rate && styles.campaignChoiceActive]} onPress={() => setCpmRate(rate)}><Text style={[styles.campaignChoiceLabel, cpmRate === rate && styles.campaignChoiceLabelActive]}>RM {rate}</Text></TouchableOpacity>)}</View></View>
    <View style={styles.campaignChoiceSection}><View style={styles.campaignBudgetHeader}><Text style={styles.flowLabel}>Total budget</Text><Text style={styles.campaignBudgetAmount}>RM {totalBudget.toLocaleString()}</Text></View><View style={styles.campaignChoiceRow}>{[100, 250, 500, 1000, 2500].map(amount => <TouchableOpacity key={amount} disabled={busy} style={[styles.campaignChoice, totalBudget === amount && styles.campaignChoiceActive]} onPress={() => setTotalBudget(amount)}><Text style={[styles.campaignChoiceLabel, totalBudget === amount && styles.campaignChoiceLabelActive]}>{amount >= 1000 ? `RM ${(amount / 1000).toFixed(amount % 1000 ? 1 : 0)}k` : `RM ${amount}`}</Text></TouchableOpacity>)}</View><View style={styles.budgetStepper}><Text style={styles.campaignPickerHint}>Adjust in RM 50 steps</Text><View style={styles.stepperControls}><TouchableOpacity accessibilityLabel="Decrease budget by RM 50" disabled={busy || totalBudget <= 50} style={styles.stepperButton} onPress={() => setTotalBudget(value => Math.max(50, value - 50))}><Text style={styles.stepperButtonText}>−</Text></TouchableOpacity><Text style={styles.stepperValue}>RM {totalBudget.toLocaleString()}</Text><TouchableOpacity accessibilityLabel="Increase budget by RM 50" disabled={busy} style={styles.stepperButton} onPress={() => setTotalBudget(value => Math.min(10000, value + 50))}><Text style={styles.stepperButtonText}>+</Text></TouchableOpacity></View></View></View>
    <View style={styles.reachEstimate}><Text style={styles.reachEstimateLabel}>Estimated ad impressions</Text><Text style={styles.reachEstimateValue}>{estimatedImpressions.toLocaleString()}</Text><Text style={styles.reachEstimateFootnote}>RM {totalBudget.toLocaleString()} budget ÷ RM {cpmRate} CPM · estimate, not guaranteed unique people</Text></View>
    {busy && <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={styles.uploadProgress}><View style={[styles.uploadProgressFill, { width: `${progress}%` }]} /></View>}
    {busy && <Text style={styles.screenSubTitle}>Uploading campaign video: {progress}%</Text>}
    {!!notice && <Text style={[styles.screenSubTitle, { marginTop: 12 }]}>{notice}</Text>}
    <TouchableOpacity style={styles.cyanPrimaryBtn} disabled={busy} onPress={submit}><Text style={styles.cyanPrimaryBtnText}>{busy ? 'Uploading and submitting…' : 'Submit campaign for review'}</Text></TouchableOpacity>
  </ScrollView></View>;
}

function CheckoutScreen({ onBack }: { onBack: () => void }) {
  return <View style={styles.flowScreen}><FlowHeader title="VIP Plan Checkout" onBack={onBack} /><ScrollView contentContainerStyle={styles.flowContent}>
    <Text style={styles.screenMainTitle}>VIP Plan Checkout</Text><Text style={styles.screenSubTitle}>Unlock every episode without ads</Text>
    <View style={styles.flowMetric}><Text style={styles.metricCardLabel}>Annual VIP Plan</Text><Text style={styles.metricBigAmount}>RM 119.90</Text><Text style={styles.metricSubInfo}>Billed yearly • Save 33%</Text></View>
    <FlowField label="Payment method" value="Visa •••• 4242" /><FlowField label="Billing email" value="aleeya@email.com" /><Text style={styles.checkoutTotal}>Total today <Text style={{ color: COLORS.cyan }}>RM 119.90</Text></Text>
    <TouchableOpacity style={styles.cyanPrimaryBtn} onPress={() => Alert.alert('Welcome to VIP', 'Your membership is active.')}><Text style={styles.cyanPrimaryBtnText}>Confirm VIP Payment</Text></TouchableOpacity>
  </ScrollView></View>;
}

function SupportScreen({ onBack }: { onBack: () => void }) {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [tickets, setTickets] = useState<Awaited<ReturnType<typeof listSupportTickets>>>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function loadTickets() {
    try {
      setTickets(await listSupportTickets());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to load support tickets.');
    }
  }

  useEffect(() => { loadTickets(); }, []);

  async function submitTicket() {
    setBusy(true);
    setNotice('');
    try {
      await createSupportTicket({ subject, description, priority: 'NORMAL' });
      setSubject('');
      setDescription('');
      setNotice('Your support request was submitted.');
      await loadTickets();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to submit support request.');
    } finally {
      setBusy(false);
    }
  }

  return <View style={styles.flowScreen}><FlowHeader title="Customer Support" onBack={onBack} /><ScrollView contentContainerStyle={styles.flowContent}>
    <Text style={styles.screenMainTitle}>Contact support</Text>
    <Text style={styles.screenSubTitle}>Requests are saved to your account.</Text>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Subject</Text><TextInput value={subject} onChangeText={setSubject} style={styles.flowInput} maxLength={200} /></View>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Message</Text><TextInput value={description} onChangeText={setDescription} style={[styles.flowInput, styles.flowTextArea]} multiline maxLength={5000} textAlignVertical="top" /></View>
    <TouchableOpacity style={styles.cyanPrimaryBtn} disabled={busy} onPress={submitTicket}><Text style={styles.cyanPrimaryBtnText}>{busy ? 'Submitting...' : 'Submit request'}</Text></TouchableOpacity>
    {!!notice && <Text style={[styles.screenSubTitle, { marginTop: 12 }]}>{notice}</Text>}
    <Text style={[styles.sectionHeaderTitle, { marginTop: 24 }]}>Your requests</Text>
    {tickets.map((ticket) => <View key={ticket.id} style={styles.pipelineCard}><View style={{ flex: 1 }}><Text style={styles.pipelineTitle}>{ticket.subject}</Text><Text style={styles.pipelineSub}>{ticket.status.replace('_', ' ')} • {new Date(ticket.createdAt).toLocaleDateString()}</Text><Text style={styles.pipelineSub}>{ticket.description}</Text></View></View>)}
    {!tickets.length && <Text style={styles.screenSubTitle}>No support requests yet.</Text>}
  </ScrollView></View>;
}

// --- STYLESHEET ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  flowScreen: { flex: 1, backgroundColor: COLORS.bg },
  flowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderColor: COLORS.cardBorder },
  flowHeaderTitle: { color: '#fff', fontSize: 14, fontWeight: '800' },
  flowContent: { padding: 16, paddingBottom: 100 },
  flowMetric: { backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 10, padding: 16, marginTop: 16 },
  flowField: { marginTop: 14 },
  flowLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', marginBottom: 6 },
  flowInput: { minHeight: 44, backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 7, color: '#fff', paddingHorizontal: 12, paddingVertical: 10, fontSize: 12 },
  flowTextArea: { minHeight: 76, textAlignVertical: 'top' },
  selectField: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 7, paddingHorizontal: 12 },
  selectValue: { color: '#fff', fontSize: 12 },
  selectChevron: { color: COLORS.cyan, fontSize: 18, fontWeight: '800' },
  selectModalBackdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.72)' },
  selectModal: { maxHeight: '80%', backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 10, padding: 16 },
  selectModalTitle: { color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 8 },
  selectOption: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder, paddingHorizontal: 8 },
  selectOptionText: { color: COLORS.textLight, fontSize: 13 },
  selectOptionTextSelected: { color: COLORS.cyan, fontWeight: '800' },
  selectCheck: { color: COLORS.cyan, fontSize: 16, fontWeight: '900' },
  uploadProgress: { height: 5, backgroundColor: COLORS.cardBorder, borderRadius: 3, overflow: 'hidden', marginTop: 16 },
  uploadProgressFill: { height: '100%', backgroundColor: COLORS.cyan },
  checkoutTotal: { color: COLORS.textMuted, fontSize: 13, fontWeight: '800', textAlign: 'right', marginTop: 18 },
  supportChat: { backgroundColor: '#102b3b', borderWidth: 1, borderColor: COLORS.cyanDark, borderRadius: 9, padding: 14, marginTop: 18 },
  chatAgent: { color: COLORS.cyan, fontSize: 11, fontWeight: '800' },
  chatMessage: { color: COLORS.textLight, fontSize: 12, marginTop: 8, lineHeight: 18 },
  secondaryFlowBtn: { alignItems: 'center', paddingVertical: 13, marginTop: 10, borderRadius: 7, borderWidth: 1, borderColor: COLORS.cardBorder },
  secondaryFlowText: { color: COLORS.cyan, fontSize: 12, fontWeight: '800' },
  topHeader: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: COLORS.cardBorder },
  backBtnText: { color: COLORS.cyan, fontSize: 16, fontWeight: '700' },

  brandHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  brandTitle: { fontSize: 20, fontWeight: '900', color: COLORS.cyan, letterSpacing: 0.8 },
  headerRightIcons: { flexDirection: 'row', gap: 14 },
  iconTxt: { color: COLORS.textLight, fontSize: 18 },

  chipRow: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: COLORS.cardBg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  chipActive: { backgroundColor: COLORS.cyan, borderColor: COLORS.cyan },
  chipText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#000', fontWeight: '800' },

  heroCard: { marginHorizontal: 16, marginTop: 8, borderRadius: 16, overflow: 'hidden' },
  heroPosterImage: {
    width: '100%',
    height: 210,
    backgroundColor: '#162e4a',
    borderBottomWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  heroGradient: {
    backgroundColor: '#162e4a',
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  heroPosterPlaceholder: {
    backgroundColor: '#162e4a',
    padding: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  posterPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a283e',
  },
  vipTag: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.gold,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginBottom: 8,
  },
  vipTagText: { color: '#000', fontSize: 10, fontWeight: '900' },
  heroDramaTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  heroSub: { color: COLORS.textMuted, fontSize: 13, marginTop: 4 },
  heroBtnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cyanActionBtn: {
    backgroundColor: COLORS.cyan,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  cyanActionBtnText: { color: '#000', fontWeight: '800', fontSize: 13 },
  listActionBtn: {
    backgroundColor: COLORS.cardBg,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  listActionBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingRight: 16,
    marginTop: 16,
  },
  sectionHeaderTitle: { color: '#fff', fontSize: 17, fontWeight: '800', marginLeft: 16, marginTop: 14 },
  seeAllText: { color: COLORS.cyan, fontSize: 13, fontWeight: '600' },

  railList: { paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  continueCard: {
    width: 140,
    backgroundColor: COLORS.cardBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    overflow: 'hidden',
  },
  continuePosterPlaceholder: {
    height: 75,
    backgroundColor: '#1a283e',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 6,
  },
  placeholderLabel: { color: COLORS.textMuted, fontSize: 11, textAlign: 'center', fontWeight: '600' },
  progressTrackSmall: { height: 4, backgroundColor: '#1e293b', width: '100%', borderRadius: 2, overflow: 'hidden', marginTop: 8 },
  progressBarSmall: { height: '100%', backgroundColor: '#ef4444' },
  cardFooterRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 8 },
  metaSmallText: { color: COLORS.textDim, fontSize: 10, fontWeight: '700' },

  popularCard: { width: 125, height: 160, borderRadius: 10, overflow: 'hidden' },
  popularPosterPlaceholder: {
    flex: 1,
    backgroundColor: COLORS.cardBg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 10,
    padding: 8,
    justifyContent: 'space-between',
  },
  popularCardTitle: { color: '#fff', fontSize: 12, fontWeight: '700' },

  badgeVip: { alignSelf: 'flex-start', backgroundColor: COLORS.gold, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
  badgeFree: { alignSelf: 'flex-start', backgroundColor: COLORS.green, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
  badgeText: { color: '#000', fontSize: 9, fontWeight: '900' },

  // Drama Details View
  dramaDescription: { color: COLORS.textMuted, fontSize: 13, marginTop: 12, lineHeight: 18 },
  cyanPrimaryBtn: {
    backgroundColor: COLORS.cyan,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 14,
  },
  cyanPrimaryBtnText: { color: '#000', fontSize: 14, fontWeight: '800' },
  episodeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 10,
  },
  episodeTitle: { color: '#fff', fontSize: 13, fontWeight: '700' },
  episodeMeta: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  cyanSmallBtn: {
    backgroundColor: COLORS.cyan,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  cyanSmallBtnText: { color: '#000', fontWeight: '800', fontSize: 12 },

  // Video Player Styles
  playerContainer: { flex: 1, backgroundColor: '#000' },
  playerTopBar: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  playerScreenTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginLeft: 12, flex: 1 },
  videoStage: {
    height: 320,
    backgroundColor: '#050a12',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  watermarkContainer: { position: 'absolute', zIndex: 99, opacity: 0.3 },
  watermarkText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  adCard: {
    width: '90%',
    backgroundColor: '#0d1829',
    borderWidth: 1,
    borderColor: COLORS.gold,
    borderRadius: 10,
    padding: 14,
  },
  adHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  daiBadge: { backgroundColor: COLORS.gold, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 },
  daiBadgeText: { color: '#000', fontSize: 10, fontWeight: '900' },
  adRemaining: { color: COLORS.textMuted, fontSize: 11 },
  adTitle: { color: '#fff', fontSize: 14, fontWeight: '800', marginTop: 8 },
  adActionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  learnMoreText: { color: COLORS.cyan, fontSize: 12, fontWeight: '700' },
  skipBtn: { backgroundColor: '#1e293b', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  skipBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  activeStreamBanner: { alignItems: 'center' },
  playerControlsArea: { padding: 16 },
  progressTrack: { height: 4, backgroundColor: '#1e293b', borderRadius: 2 },
  progressBar: { height: '100%', backgroundColor: COLORS.cyan, borderRadius: 2 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  timeText: { color: COLORS.textMuted, fontSize: 11 },
  midRollNotice: { color: COLORS.gold, fontSize: 11, fontWeight: '700' },
  controlButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: 20,
  },
  ctrlSubText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  playPauseCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.cyan,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playPauseIcon: { color: '#000', fontSize: 18, fontWeight: '900' },

  // Search View Styles
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  searchBarIcon: { color: COLORS.textMuted, fontSize: 16 },
  searchInput: { flex: 1, height: 44, color: '#fff', paddingHorizontal: 10 },
  filterIcon: { color: COLORS.textMuted, fontSize: 16 },
  resultsCount: { color: COLORS.cyan, fontSize: 12, fontWeight: '700', marginTop: 2 },
  errorBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#3f1d25',
    borderColor: '#9f1239',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    margin: 16,
  },
  errorText: { color: '#fecdd3', flex: 1, fontSize: 12, marginRight: 10 },
  searchResultCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.cardBg,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 10,
  },
  searchThumbPlaceholder: {
    width: 60,
    height: 60,
    backgroundColor: '#1b293d',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchThumbLabel: { color: COLORS.textDim, fontSize: 10, fontWeight: '800' },
  searchResultTitle: { color: '#fff', fontSize: 13, fontWeight: '800' },
  searchResultMeta: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  badgeTagMini: { alignSelf: 'flex-start', marginTop: 6 },
  badgeTextMini: { color: '#000', fontSize: 9, fontWeight: '900' },

  // Creator & Ads Styles
  creatorPage: { padding: 16, paddingBottom: 96 },
  creatorPageHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  creatorKpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 24 },
  creatorKpiCard: { flexBasis: '48%', flexGrow: 1, minHeight: 96, backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 8, padding: 12 },
  creatorKpiLabel: { color: COLORS.textDim, fontSize: 10, fontWeight: '700' },
  creatorKpiValue: { color: COLORS.cyan, fontSize: 20, fontWeight: '900', marginTop: 7 },
  creatorKpiFootnote: { color: COLORS.textDim, fontSize: 9, marginTop: 3 },
  creatorSectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 10 },
  creatorEmpty: { color: COLORS.textDim, fontSize: 12, textAlign: 'center', paddingVertical: 28 },
  creatorContentCard: { backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 8, padding: 12, marginBottom: 10 },
  creatorContentHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  creatorPoster: { width: 58, height: 78, borderRadius: 5, backgroundColor: '#172536' },
  creatorContentInfo: { flex: 1, minWidth: 0 },
  creatorMeta: { color: COLORS.cyan, fontSize: 9, marginTop: 4 },
  creatorStatusApproved: { color: COLORS.green, fontSize: 9, fontWeight: '800', marginTop: 5 },
  creatorStatusRejected: { color: '#fca5a5', fontSize: 9, fontWeight: '800', marginTop: 5 },
  creatorStatusPending: { color: COLORS.gold, fontSize: 9, fontWeight: '800', marginTop: 5 },
  creatorDetailsAction: { color: COLORS.cyan, fontSize: 10, fontWeight: '800', padding: 6 },
  creatorStatsRow: { flexDirection: 'row', borderTopWidth: 1, borderColor: COLORS.cardBorder, marginTop: 12, paddingTop: 10 },
  creatorStatCell: { flex: 1 },
  creatorStatValue: { color: '#fff', fontSize: 12, fontWeight: '800', marginTop: 4 },
  creatorDetails: { borderTopWidth: 1, borderColor: COLORS.cardBorder, marginTop: 12, paddingTop: 12 },
  creatorContentActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18, borderTopWidth: 1, borderColor: COLORS.cardBorder, marginTop: 10, paddingTop: 9 },
  creatorDeleteAction: { color: '#fca5a5', fontSize: 10, fontWeight: '800', padding: 6 },
  creatorDetailsHeading: { color: '#fff', fontSize: 11, fontWeight: '800', marginTop: 7, marginBottom: 5 },
  creatorDetailText: { color: COLORS.textDim, fontSize: 10, lineHeight: 16 },
  creatorEpisodeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 7, borderTopWidth: 1, borderColor: COLORS.cardBorder },
  creatorPayoutCard: { backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 8, padding: 14, marginTop: 18 },
  creatorPayoutAvailable: { color: COLORS.green, fontSize: 16, fontWeight: '900' },
  creatorPayoutForm: { flexDirection: 'row', gap: 8, marginTop: 8 },
  creatorPayoutInput: { flex: 1, minHeight: 40, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 7, color: '#fff', paddingHorizontal: 10, fontSize: 11 },
  creatorPayoutRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderColor: COLORS.cardBorder },
  creatorHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  screenMainTitle: { color: '#fff', fontSize: 20, fontWeight: '900' },
  screenSubTitle: { color: COLORS.textDim, fontSize: 12, marginTop: 2 },
  uploadBtn: { backgroundColor: COLORS.cyan, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  uploadBtnText: { color: '#000', fontWeight: '800', fontSize: 12 },
  metricCard: {
    backgroundColor: COLORS.cardBg,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 16,
  },
  metricCardLabel: { color: '#fff', fontSize: 14, fontWeight: '800' },
  metricBigAmount: { color: COLORS.cyan, fontSize: 26, fontWeight: '900', marginTop: 6 },
  metricSubInfo: { color: COLORS.textDim, fontSize: 11, marginTop: 4 },
  pipelineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 10,
  },
  pipelineTitle: { color: '#fff', fontSize: 13, fontWeight: '700' },
  pipelineSub: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  badgeWarning: { backgroundColor: '#713f12', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  badgeWarningText: { color: COLORS.gold, fontSize: 10, fontWeight: '800' },
  badgeSuccess: { backgroundColor: '#064e3b', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  badgeSuccessText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },

  campaignCard: {
    backgroundColor: COLORS.cardBg,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 16,
  },
  campaignHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  campaignTitle: { color: '#fff', fontSize: 14, fontWeight: '800' },
  campaignSub: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  advertiserPage: { padding: 16, paddingBottom: 96 },
  advertiserHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  advertiserHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  advertiserRefresh: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 11, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 7 },
  advertiserSummaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  advertiserSummaryCard: { flexBasis: '47%', flexGrow: 1, minWidth: 128, minHeight: 76, backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 8, padding: 11 },
  advertiserSummaryLabel: { color: COLORS.textDim, fontSize: 9, fontWeight: '700' },
  advertiserSummaryValue: { color: '#fff', fontSize: 16, fontWeight: '900', marginTop: 7 },
  advertiserEmpty: { alignItems: 'center', backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 8, padding: 24, marginTop: 8 },
  advertiserCampaignCard: { backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 8, padding: 14, marginTop: 10 },
  advertiserCampaignHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  advertiserStatusActive: { color: COLORS.green, backgroundColor: '#064e3b', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, fontSize: 9, fontWeight: '800' },
  advertiserStatusPaused: { color: COLORS.gold, backgroundColor: '#713f12', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, fontSize: 9, fontWeight: '800' },
  advertiserBudgetHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  advertiserBudgetMain: { color: '#fff', fontSize: 19, fontWeight: '900' },
  advertiserBudgetMinor: { color: COLORS.textDim, fontSize: 10, fontWeight: '500' },
  advertiserBudgetTotal: { color: COLORS.textDim, fontSize: 10 },
  advertiserBudgetTrack: { height: 6, backgroundColor: '#101a27', borderRadius: 4, overflow: 'hidden', marginTop: 10 },
  advertiserBudgetFill: { height: '100%', backgroundColor: COLORS.cyan, borderRadius: 4 },
  advertiserCampaignStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, borderTopWidth: 1, borderColor: COLORS.cardBorder, marginTop: 12, paddingTop: 12 },
  advertiserCampaignStatValue: { color: '#fff', fontSize: 11, fontWeight: '800', marginTop: 4 },
  creativePicker: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 62, padding: 11, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 8, backgroundColor: COLORS.cardBg },
  creativePickerIcon: { color: COLORS.cyan, fontSize: 18, fontWeight: '900' },
  creativePickerTitle: { color: '#fff', fontSize: 11, fontWeight: '800' },
  creativePickerSub: { color: COLORS.textDim, fontSize: 9, marginTop: 4 },
  creativePickerAction: { color: COLORS.cyan, fontSize: 10, fontWeight: '800' },
  campaignChoiceSection: { marginTop: 16 },
  campaignChoiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 7 },
  campaignChoice: { minHeight: 37, justifyContent: 'center', paddingHorizontal: 12, backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 7 },
  campaignChoiceActive: { borderColor: COLORS.cyan, backgroundColor: '#103344' },
  campaignChoiceLabel: { color: COLORS.textDim, fontSize: 10, fontWeight: '700' },
  campaignChoiceLabelActive: { color: COLORS.cyan },
  campaignBudgetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  campaignBudgetAmount: { color: '#fff', fontSize: 15, fontWeight: '900' },
  budgetStepper: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  campaignPickerHint: { color: COLORS.textDim, fontSize: 9 },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  stepperButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 7 },
  stepperButtonText: { color: COLORS.cyan, fontSize: 20, fontWeight: '700' },
  stepperValue: { minWidth: 70, textAlign: 'center', color: '#fff', fontSize: 11, fontWeight: '800' },
  reachEstimate: { alignItems: 'center', backgroundColor: '#0d1c27', borderWidth: 1, borderColor: '#174b58', borderRadius: 8, padding: 16, marginTop: 18 },
  reachEstimateLabel: { color: COLORS.textDim, fontSize: 10, fontWeight: '700' },
  reachEstimateValue: { color: COLORS.cyan, fontSize: 28, fontWeight: '900', marginTop: 5 },
  reachEstimateFootnote: { color: COLORS.textDim, fontSize: 9, marginTop: 5, textAlign: 'center' },
  paramGrid: { backgroundColor: '#0d1624', padding: 10, borderRadius: 8, marginTop: 12 },
  paramRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 2 },
  paramLabel: { color: COLORS.textDim, fontSize: 11 },
  paramValue: { color: '#fff', fontSize: 11, fontWeight: '600' },
  statColumnsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  statBox: {
    flex: 1,
    backgroundColor: '#0d1624',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  statValue: { color: COLORS.cyan, fontSize: 16, fontWeight: '900' },
  statKey: { color: COLORS.textDim, fontSize: 10, marginTop: 2 },

  // Profile View Styles
  profileUserRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#38bdf8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { color: '#000', fontSize: 20, fontWeight: '900' },
  profileName: { color: '#fff', fontSize: 18, fontWeight: '900' },
  profileEmail: { color: COLORS.textDim, fontSize: 12, marginTop: 2 },
  vipHeaderCentered: { color: '#fff', fontSize: 18, fontWeight: '900', textAlign: 'center', marginTop: 10 },
  vipSubCentered: { color: COLORS.textDim, fontSize: 12, textAlign: 'center', marginTop: 4, marginBottom: 14 },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 10,
  },
  planCardActive: { borderColor: COLORS.cyan },
  planTitle: { color: '#fff', fontSize: 14, fontWeight: '800' },
  planBadgeText: { color: COLORS.gold, fontSize: 11, fontWeight: '700', marginTop: 2 },
  planPrice: { color: '#fff', fontSize: 14, fontWeight: '900' },
  planSub: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  referralCard: {
    backgroundColor: COLORS.cardBg,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 16,
  },
  referralTitle: { color: '#fff', fontSize: 13, fontWeight: '800' },
  referralCode: { color: COLORS.textDim, fontSize: 12, marginTop: 4 },
  whatsappBtn: {
    backgroundColor: COLORS.greenBtn,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 10,
  },
  whatsappBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  supportCard: {
    backgroundColor: COLORS.cardBg,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 12,
  },
  supportHeader: { color: '#fff', fontSize: 13, fontWeight: '800' },
  supportSub: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  contactSupportLink: { color: COLORS.cyan, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },

  // Bottom Navigation Bar
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: '#0a1220',
    borderTopWidth: 1,
    borderColor: COLORS.cardBorder,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  navItem: { alignItems: 'center', justifyContent: 'center' },
  navIcon: { color: COLORS.textDim, fontSize: 16 },
  navLabel: { color: COLORS.textDim, fontSize: 10, fontWeight: '600', marginTop: 2 },
});