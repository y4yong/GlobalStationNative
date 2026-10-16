import React, { useState, useEffect, useRef, useCallback } from 'react';
import { keepLocalCopy, pick, types } from '@react-native-documents/picker';
import ReactNativeBlobUtil from 'react-native-blob-util';
import Video, { ViewType } from 'react-native-video';
import {
  ActivityIndicator,
  BackHandler,
  SafeAreaView,
  View,
  Text as NativeText,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput as NativeTextInput,
  StatusBar,
  Platform,
  Alert,
  Linking,
  Share,
  Switch,
  Image,
  Modal,
} from 'react-native';
import type { TextInputProps, TextProps } from 'react-native';
import { DramaItem } from './src/data/models/Drama';
import { COLORS } from './src/theme/colors';
import { ProtectedVideoPlayer } from './src/components/ProtectedVideoPlayer';
import { getDueAdBreak, PlaybackAdBreak } from './src/core/playback/adBreakSchedule';
import { AdPayload, addCreatorEpisode, archiveCreatorContent, createAdvertiserCampaign, createAdvertiserUpload, createCreatorPosterUpload, createCreatorUpload, createSupportTicket, createVipCheckout, deleteCreatorContent, getAdPayload, getCatalog, getCreatorDashboard, getViewerProfile, listAdvertiserCampaigns, listSupportTickets, loginViewer, recordAdClick, recordAdProgress, registerViewer, requestCreatorPayout, searchCatalog, setLocationAnalyticsEnabled, submitCreatorContent, updateCreatorContent, upgradeViewerRole, ViewerProfile, CreatorSubmission, getNotifications, getNotificationPreferences, getReferralOverview, markAllNotificationsRead, markNotificationRead, updateNotificationPreferences, InAppNotification, NotificationPreferences, ReferralOverview } from './src/api/client';
import { clearSession, readSession } from './src/core/security/sessionStorage';
import { requestViewingLocationPermission } from './src/core/location/viewingLocation';
import { formatDate } from './src/core/formatDate';
import { CONTENT_CATEGORIES, CONTENT_GENRES } from './src/data/contentOptions';

const Text = ({ style, ...props }: TextProps) => {
  const textStyle = StyleSheet.flatten(style);
  const fontSize = textStyle?.fontSize;
  return <NativeText {...props} style={[style, {
    fontFamily: textStyle?.fontFamily ?? Platform.select({ android: 'sans-serif', ios: 'System' }),
    fontSize: Math.max(typeof fontSize === 'number' ? fontSize : 16, 12),
  }]} />;
};

const TextInput = ({ style, ...props }: TextInputProps) => {
  const inputStyle = StyleSheet.flatten(style);
  const fontSize = inputStyle?.fontSize;
  const minHeight = inputStyle?.minHeight;
  return <NativeTextInput {...props} style={[style, {
    fontFamily: Platform.select({ android: 'sans-serif', ios: 'System' }),
    fontSize: Math.max(typeof fontSize === 'number' ? fontSize : 16, 16),
    minHeight: Math.max(typeof minHeight === 'number' ? minHeight : 0, 52),
  }]} />;
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'Home' | 'Search' | 'Creator' | 'Ads' | 'Profile'>('Home');
  const [currentScreen, setCurrentScreen] = useState<'Tabs' | 'Details' | 'Player' | 'Payout' | 'Upload' | 'Campaign' | 'Support' | 'Engagement' | 'EditCreatorContent' | 'AddCreatorEpisode'>('Tabs');
  const [catalog, setCatalog] = useState<DramaItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedDrama, setSelectedDrama] = useState<DramaItem | null>(null);
  const [selectedCreatorSubmission, setSelectedCreatorSubmission] = useState<CreatorSubmission | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState('');
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [adBreakPhase, setAdBreakPhase] = useState<'pre-roll' | PlaybackAdBreak | null>(null);
  const [adFullscreen, setAdFullscreen] = useState(false);
  const activeAdBreak = useRef<'pre-roll' | PlaybackAdBreak | null>(null);
  const playedAdBreaks = useRef(new Set<PlaybackAdBreak>());
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
    getCatalog()
      .then((items) => setCatalog(items.filter((item) => !!item && typeof item.id === 'string' && item.id.trim().length > 0)))
      .catch(() => setCatalogError('The catalog is unavailable. Check the API connection and try again.'))
      .finally(() => setCatalogLoading(false));
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  useEffect(() => {
    if (!adFullscreen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setAdFullscreen(false);
      return true;
    });
    return () => subscription.remove();
  }, [adFullscreen]);

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
    setDescriptionExpanded(false);
    setCurrentScreen('Details');
  };

  const startPlayback = (drama: DramaItem, epTitle?: string) => {
    const episode = drama.episodes.find((item) => item.title === epTitle) ?? drama.episodes[0];
    if (!episode) {
      Alert.alert('Playback unavailable', 'This title does not have an episode with a media source yet.');
      return;
    }
    setSelectedDrama(drama);
    setSelectedEpisode(episode.title);
    playedAdBreaks.current.clear();
    activeAdBreak.current = 'pre-roll';
    setAdBreakPhase('pre-roll');
    setCurrentScreen('Player');
  };

  const handlePlaybackProgress = (currentTime: number, duration: number) => {
    if (activeAdBreak.current !== null) return;
    const dueBreak = getDueAdBreak(currentTime, duration, playedAdBreaks.current);
    if (dueBreak) {
      playedAdBreaks.current.add(dueBreak);
      activeAdBreak.current = dueBreak;
      setAdBreakPhase(dueBreak);
    }
  };

  const finishAdBreak = (phase: 'pre-roll' | PlaybackAdBreak) => {
    if (activeAdBreak.current !== phase) return;
    activeAdBreak.current = null;
    setAdBreakPhase(null);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle="dark-content"
        hidden={adFullscreen}
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

          <ScrollView contentContainerStyle={styles.detailsContent}>
            <View style={styles.heroCard}>
              <PosterImage uri={selectedDrama.posterUrl} title={selectedDrama.title} style={styles.heroPosterImage} />
              <View style={styles.heroGradient}>
                <Text style={styles.heroDramaTitle}>{selectedDrama.title}</Text>
                <Text style={styles.heroSub}>{selectedDrama.genre} • {selectedDrama.rating}</Text>
              </View>
            </View>

            <Text numberOfLines={descriptionExpanded ? undefined : 4} style={styles.dramaDescription}>{selectedDrama.description}</Text>
            {selectedDrama.description.length > 180 && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ expanded: descriptionExpanded }}
                style={styles.descriptionToggle}
                onPress={() => setDescriptionExpanded((expanded) => !expanded)}
              >
                <Text style={styles.descriptionToggleText}>{descriptionExpanded ? 'Show less' : 'Read full description'}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.cyanPrimaryBtn}
              activeOpacity={0.8}
              onPress={() => startPlayback(selectedDrama, selectedDrama.episodes[0]?.title)}
            >
              <Text style={styles.cyanPrimaryBtnText}>▶ Play Episode</Text>
            </TouchableOpacity>

            <Text style={styles.sectionHeaderTitle}>Episodes</Text>
            {selectedDrama.episodes.map((ep) => (
              <View key={ep.id} style={styles.episodeCard}>
                <View style={{ flex: 1 }}>
                  <View style={styles.episodeTitleRow}>
                    <Text style={styles.episodeTitle}>{ep.title}</Text>
                    {ep.requiresVip && <Text style={styles.vipTitleLabel}>VIP</Text>}
                  </View>
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
        <View style={[styles.playerContainer, adFullscreen && styles.playerFullscreen]}>
          {!adFullscreen && <View style={styles.playerTopBar}>
            <TouchableOpacity onPress={() => setCurrentScreen('Tabs')}>
              <Text style={styles.backBtnText}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.playerScreenTitle} numberOfLines={1}>{selectedDrama.title} ({selectedDrama.rating})</Text>
          </View>}

          <View style={[styles.videoStage, adFullscreen && styles.videoStageFullscreen]}>
            <ProtectedVideoPlayer
              episodeId={selectedDrama.episodes.find((episode) => episode.title === selectedEpisode)!.id}
              paused={adBreakPhase !== null}
              shareViewingLocation={profile.locationAnalyticsEnabled}
              onPlaybackProgress={handlePlaybackProgress}
            />
            {adBreakPhase !== null && <AdBreak
              key={adBreakPhase}
              fullscreen={adFullscreen}
              onComplete={() => { setAdFullscreen(false); finishAdBreak(adBreakPhase); }}
              onToggleFullscreen={() => setAdFullscreen(current => !current)}
            />}
            <View pointerEvents="none" style={styles.watermarkContainer}>
              <Text style={styles.watermarkText}>GLOBAL STATION</Text>
            </View>
          </View>
        </View>
      ) : currentScreen === 'Payout' ? (
        <PayoutScreen onBack={() => setCurrentScreen('Tabs')} />
      ) : currentScreen === 'Upload' ? (
        <UploadScreen onBack={() => setCurrentScreen('Tabs')} />
      ) : currentScreen === 'EditCreatorContent' && selectedCreatorSubmission ? (
        <EditCreatorContentScreen
          submission={selectedCreatorSubmission}
          onBack={() => setCurrentScreen('Tabs')}
          onSaved={() => setCurrentScreen('Tabs')}
        />
      ) : currentScreen === 'AddCreatorEpisode' && selectedCreatorSubmission ? (
        <AddCreatorEpisodeScreen
          submission={selectedCreatorSubmission}
          onBack={() => setCurrentScreen('Tabs')}
          onSaved={() => setCurrentScreen('Tabs')}
        />
      ) : currentScreen === 'Campaign' ? (
        <CampaignScreen onBack={() => setCurrentScreen('Tabs')} />
      ) : currentScreen === 'Support' ? (
        <SupportScreen onBack={() => setCurrentScreen('Tabs')} />
      ) : currentScreen === 'Engagement' ? (
        <EngagementScreen profile={profile} onBack={() => setCurrentScreen('Tabs')} onLocationSharingChange={async (enabled) => { await setLocationAnalyticsEnabled(enabled); const updated = await getViewerProfile(); setProfile(updated); }} />
      ) : (
        /* SCREEN 1, 4, 5, 6: TAB VIEWS */
        <View style={{ flex: 1 }}>
          {activeTab === 'Home' && <HomeTabView dramas={catalog} loading={catalogLoading} error={catalogError} onRetry={loadCatalog} onSelect={openDramaDetails} onPlay={startPlayback} onSearch={() => setActiveTab('Search')} onProfile={() => setActiveTab('Profile')} />}
          {activeTab === 'Search' && <SearchTabView dramas={catalog} loading={catalogLoading} onSelect={openDramaDetails} />}
          {activeTab === 'Creator' && <CreatorTabView
            creatorName={profile.name}
            onUpload={() => setCurrentScreen('Upload')}
            onEdit={submission => { setSelectedCreatorSubmission(submission); setCurrentScreen('EditCreatorContent'); }}
            onAddEpisode={submission => { setSelectedCreatorSubmission(submission); setCurrentScreen('AddCreatorEpisode'); }}
          />}
          {activeTab === 'Ads' && <AdsTabView onCampaign={() => setCurrentScreen('Campaign')} />}
          {activeTab === 'Profile' && <ProfileTabView profile={profile} onSupport={() => setCurrentScreen('Support')} onEngagement={() => setCurrentScreen('Engagement')} onRefreshProfile={async () => { const updated = await getViewerProfile(); setProfile(updated); }} onUpgradeRole={async (role) => { const updated = await upgradeViewerRole(role); setProfile(updated); }} onSignOut={async () => { await clearSession(); setProfile(null); setCurrentScreen('Tabs'); setActiveTab('Home'); }} />}
        </View>
      )}

      {/* ===================== BOTTOM NAVIGATION ===================== */}
      {currentScreen === 'Tabs' && <View style={styles.bottomNav}>
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
      </View>}
    </SafeAreaView>
  );
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (profile: ViewerProfile) => void }) {
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const profile = registering
        ? await registerViewer(name, email, password, referralCode.trim() || undefined)
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
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
        <Text style={styles.authLogo}>GLOBAL STATION</Text>
        <Text style={[styles.screenMainTitle, { marginTop: 24 }]}>{registering ? 'Create your account' : 'Sign in'}</Text>
        <Text style={styles.screenSubTitle}>Your account connects to the Global Station service.</Text>
        {registering && <TextInput placeholder="Full name" placeholderTextColor={COLORS.textDim} autoCapitalize="words" value={name} onChangeText={setName} style={styles.flowInput} />}
        <TextInput placeholder="Email" placeholderTextColor={COLORS.textDim} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} style={[styles.flowInput, { marginTop: 14 }]} />
        <TextInput placeholder="Password (at least 8 characters)" placeholderTextColor={COLORS.textDim} secureTextEntry value={password} onChangeText={setPassword} style={[styles.flowInput, { marginTop: 14 }]} />
        {registering && <TextInput placeholder="Referral code (e.g. GS-ABC123)" placeholderTextColor={COLORS.textDim} autoCapitalize="characters" autoCorrect={false} maxLength={40} value={referralCode} onChangeText={value => setReferralCode(value.toUpperCase().replace(/\s/g, ''))} style={[styles.flowInput, { marginTop: 14 }]} />}
        {registering && <Text style={[styles.screenSubTitle, { marginTop: 14 }]}>Every new account starts as a Basic user. You can request more account roles from your profile.</Text>}
        {!!error && <Text style={{ color: COLORS.danger, marginTop: 14 }}>{error}</Text>}
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

function HomeTabView({ dramas, loading, error, onRetry, onSelect, onPlay, onSearch, onProfile }: { dramas: DramaItem[]; loading: boolean; error: string | null; onRetry: () => void; onSelect: (d: DramaItem) => void; onPlay: (d: DramaItem) => void; onSearch: () => void; onProfile: () => void }) {
  const [filter, setFilter] = useState('All');
  const normalizedFilter = filter.trim().toLowerCase();
  const filters = ['All', ...Array.from(new Set(dramas.flatMap((drama) => [
    drama.category,
    ...drama.genre.split(',').map((genre) => genre.trim()).filter(Boolean),
  ]))).sort()];
  const visibleDramas = filter === 'All'
    ? dramas
    : dramas.filter((d) => {
        const categoryMatch = d.category?.toLowerCase().includes(normalizedFilter) || d.genre?.toLowerCase().includes(normalizedFilter);
        return categoryMatch;
      });
  const continueWatching = visibleDramas.filter((d) => d.progress);
  const homeDramas = visibleDramas.filter((drama) => !drama.progress && (filter !== 'All' || drama.id !== dramas[0]?.id));
  const trendingDramas = [...homeDramas].sort((a, b) => b.trendingViews - a.trendingViews).slice(0, 10);
  const originalSeries = homeDramas.filter((drama) => drama.contentType === 'SERIES').slice(0, 10);
  const newReleases = [...homeDramas].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 10);
  const renderRail = (title: string, items: DramaItem[]) => items.length > 0 && <>
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionHeaderTitle}>{title}</Text>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railList}>
      {items.map((drama) => (
        <TouchableOpacity key={drama.id} style={styles.popularCard} onPress={() => onSelect(drama)}>
          <View style={styles.popularPosterFrame}>
            <PosterImage uri={drama.posterUrl} title={drama.title} style={styles.popularPosterPlaceholder} />
          </View>
          <Text numberOfLines={2} style={styles.popularCardTitle}>{drama.title}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  </>;
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
        {filters.map((c) => (
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
      {filter === 'All' && dramas[0] && <View style={styles.heroCard}>
        <PosterImage uri={dramas[0].posterHorizontalUrl ?? dramas[0].posterUrl} title={dramas[0].title} style={styles.heroPosterImage} />
        <View style={styles.heroGradient}>
          <Text style={styles.heroDramaTitle}>{dramas[0].title}</Text>
          <Text style={styles.heroSub}>{dramas[0].genre} • {dramas[0].rating}</Text>

          <View style={styles.heroBtnRow}>
            <TouchableOpacity style={styles.cyanActionBtn} onPress={() => onPlay(dramas[0])}>
              <Text style={styles.cyanActionBtnText}>▶ Watch Episode 1</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>}

      {continueWatching.length > 0 && <>
        <Text style={styles.sectionHeaderTitle}>Continue watching</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railList}>
          {continueWatching.map((d) => (
            <TouchableOpacity key={d.id} style={styles.continueCard} onPress={() => onSelect(d)}>
              <PosterImage uri={d.posterUrl} title={d.title} style={styles.continuePosterPlaceholder} />
              <View style={styles.progressTrackSmall}>
                <View style={[styles.progressBarSmall, { width: `${(d.progress || 0) * 100}%` }]} />
              </View>
              <View style={styles.cardFooterRow}>
                <Text style={styles.metaSmallText}>{d.timeLeft}</Text>
                <Text style={styles.metaSmallText}>{d.rating}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </>}

      {renderRail('Trending Now', trendingDramas)}
      {renderRail('Original Series', originalSeries)}
      {renderRail('New Releases', newReleases)}
      {!loading && !error && visibleDramas.length === 0 && <Text style={styles.emptyCatalog}>No titles found.</Text>}
    </ScrollView>
  );
}

// --- TAB 2: SEARCH & FILTER ---
function SearchTabView({ dramas, loading, onSelect }: { dramas: DramaItem[]; loading: boolean; onSelect: (d: DramaItem) => void }) {
  const [query, setQuery] = useState('');
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const [selectedGenre, setSelectedGenre] = useState('All');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedType, setSelectedType] = useState<'All' | 'MOVIE' | 'SERIES'>('All');
  const [results, setResults] = useState<DramaItem[]>(dramas);
  const [searchError, setSearchError] = useState('');
  const categories = Array.from(new Set([...CONTENT_CATEGORIES, ...dramas.map(drama => drama.category).filter(Boolean)])).sort();

  useEffect(() => {
    setResults(dramas);
  }, [dramas]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (loading) return;
      const normalizedQuery = query.trim();
      if (!normalizedQuery) {
        setResults(dramas);
        setSearchError('');
        return;
      }
      searchCatalog(normalizedQuery)
        .then(items => {
          if (!active) return;
          setResults(items);
          setSearchError('');
        })
        .catch(error => {
          if (!active) return;
          setSearchError(error instanceof Error ? error.message : 'Unable to search titles.');
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, dramas, loading]);

  const filtered = results.filter((d) => {
    const matchesGenre = selectedGenre === 'All' || d.genre.split(',').some((genre) => genre.trim().toLowerCase() === selectedGenre.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || d.category.trim().toLowerCase() === selectedCategory.toLowerCase();
    const matchesType = selectedType === 'All' || d.contentType === selectedType;
    return matchesGenre && matchesCategory && matchesType;
  });
  const hasActiveFilters = selectedGenre !== 'All' || selectedCategory !== 'All' || selectedType !== 'All';
  const activeFilterCount = [selectedGenre, selectedCategory, selectedType].filter(value => value !== 'All').length;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }}>
      <Text style={styles.screenMainTitle}>Search</Text>
      <Text style={styles.screenSubTitle}>Find titles by name, genre, category, or type.</Text>
      <View style={styles.searchBar}>
        <Text style={styles.searchBarIcon}>⚲</Text>
        <TextInput
          placeholder="Search titles..."
          placeholderTextColor={COLORS.textDim}
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      <View style={styles.searchFilterPanel}>
        <View style={styles.searchFilterHeader}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ expanded: filtersExpanded }}
            accessibilityLabel={filtersExpanded ? 'Hide search filters' : 'Show search filters'}
            style={styles.searchFilterToggle}
            onPress={() => setFiltersExpanded(expanded => !expanded)}
          >
            <View style={styles.searchFilterHeading}>
              <Text style={styles.searchFilterTitle}>Filters</Text>
              {activeFilterCount > 0 && <View style={styles.searchFilterCount}><Text style={styles.searchFilterCountText}>{activeFilterCount}</Text></View>}
            </View>
            <Text style={styles.searchFilterToggleText}>{filtersExpanded ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
          {hasActiveFilters && <TouchableOpacity accessibilityRole="button" onPress={() => {
            setSelectedGenre('All');
            setSelectedCategory('All');
            setSelectedType('All');
          }}><Text style={styles.searchFilterReset}>Reset</Text></TouchableOpacity>}
        </View>
        {filtersExpanded && <View style={styles.searchFilterOptions}>
        <Text style={styles.searchFilterLabel}>GENRE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.searchFilterRow}>
          {['All', ...CONTENT_GENRES].map(genre => (
            <TouchableOpacity key={genre} accessibilityRole="button" accessibilityState={{ selected: selectedGenre === genre }} style={[styles.searchFilterChip, selectedGenre === genre && styles.searchFilterChipActive]} onPress={() => setSelectedGenre(genre)}>
              <Text style={[styles.searchFilterChipText, selectedGenre === genre && styles.searchFilterChipTextActive]}>{genre === 'All' ? 'Any' : genre}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Text style={styles.searchFilterLabel}>CATEGORY</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.searchFilterRow}>
          {['All', ...categories].map(category => (
            <TouchableOpacity key={category} accessibilityRole="button" accessibilityState={{ selected: selectedCategory === category }} style={[styles.searchFilterChip, selectedCategory === category && styles.searchFilterChipActive]} onPress={() => setSelectedCategory(category)}>
              <Text style={[styles.searchFilterChipText, selectedCategory === category && styles.searchFilterChipTextActive]}>{category === 'All' ? 'Any' : category}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Text style={styles.searchFilterLabel}>TYPE</Text>
        <View style={styles.searchFilterInline}>
          {(['All', 'MOVIE', 'SERIES'] as const).map(type => (
            <TouchableOpacity key={type} accessibilityRole="button" accessibilityState={{ selected: selectedType === type }} style={[styles.searchFilterChip, styles.searchFilterInlineChip, selectedType === type && styles.searchFilterChipActive]} onPress={() => setSelectedType(type)}>
              <Text style={[styles.searchFilterChipText, selectedType === type && styles.searchFilterChipTextActive]}>{type === 'MOVIE' ? 'Movie' : type === 'SERIES' ? 'Series' : 'Any'}</Text>
            </TouchableOpacity>
          ))}
        </View></View>}
      </View>

      <View style={styles.searchResultsHeader}>
        <Text style={styles.searchFilterTitle}>Titles</Text>
        <Text style={styles.resultsCount}>{filtered.length}{loading ? ' · Loading' : ' results'}</Text>
      </View>
      {!!searchError && <Text style={styles.errorText}>{searchError}</Text>}

      {filtered.map((d) => (
        <TouchableOpacity key={d.id} style={styles.searchResultCard} onPress={() => onSelect(d)}>
          <PosterImage uri={d.posterUrl} title={d.title} style={styles.searchThumbPlaceholder} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.searchResultTitle}>{d.title}</Text>
            <Text style={styles.searchResultMeta}>{d.genre} • {d.rating} {d.tag ? `• ${d.tag}` : ''}</Text>
          </View>
        </TouchableOpacity>
      ))}
      {!loading && filtered.length === 0 && <Text style={styles.emptyCatalog}>No titles found.</Text>}
    </ScrollView>
  );
}

// --- TAB 3: CREATOR STUDIO ---
function CreatorTabView({ creatorName, onUpload, onEdit, onAddEpisode }: {
  creatorName: string;
  onUpload: () => void;
  onEdit: (submission: CreatorSubmission) => void;
  onAddEpisode: (submission: CreatorSubmission) => void;
}) {
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
          <Text style={styles.pipelineSub}>{submission.episodeCount} episode(s) · Submitted {formatDate(submission.createdAt)}</Text>
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
        <TouchableOpacity style={styles.creatorManageButton} disabled={loading || submission.isArchived} onPress={() => onEdit(submission)}><Text style={styles.creatorManageButtonText}>Edit details</Text></TouchableOpacity>
        {submission.contentType === 'SERIES' && <TouchableOpacity style={styles.creatorManageButton} disabled={loading || submission.isArchived} onPress={() => onAddEpisode(submission)}><Text style={styles.creatorManageButtonText}>+ Add episode</Text></TouchableOpacity>}
        <TouchableOpacity disabled={loading} onPress={() => confirmArchive(submission)}><Text style={styles.creatorDetailsAction}>{submission.isArchived ? 'Restore' : 'Archive'}</Text></TouchableOpacity>
        <TouchableOpacity disabled={loading} onPress={() => confirmDelete(submission)}><Text style={styles.creatorDeleteAction}>Delete permanently</Text></TouchableOpacity>
      </View>
    </View>)}

    <View style={styles.creatorPayoutCard}>
      <View style={styles.creatorSectionHeading}><View><Text style={styles.screenMainTitle}>Payouts</Text><Text style={styles.screenSubTitle}>Request a transfer of available creator earnings.</Text></View><Text style={styles.creatorPayoutAvailable}>RM {Number(dashboard?.payouts.available ?? 0).toFixed(2)}</Text></View>
      <View style={styles.creatorPayoutForm}><TextInput value={payoutAmount} onChangeText={setPayoutAmount} editable={!payoutBusy} keyboardType="decimal-pad" placeholder={`Minimum RM ${dashboard?.payouts.minimumRequest ?? '20.00'}`} placeholderTextColor={COLORS.textDim} style={styles.creatorPayoutInput} /><TouchableOpacity style={styles.uploadBtn} disabled={payoutBusy || loading} onPress={submitPayoutRequest}><Text style={styles.uploadBtnText}>{payoutBusy ? 'Requesting…' : 'Request payout'}</Text></TouchableOpacity></View>
      {!!payoutNotice && <Text style={styles.screenSubTitle}>{payoutNotice}</Text>}
      {(dashboard?.payouts.requests ?? []).slice(0, 5).map(request => <View key={request.id} style={styles.creatorPayoutRow}><Text style={styles.creatorDetailText}>{formatDate(request.requestedAt)} · RM {Number(request.amount).toFixed(2)}</Text><Text style={styles.creatorMeta}>{request.status}</Text></View>)}
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
          <View style={styles.advertiserCampaignHeading}><View style={{ flex: 1 }}><Text style={styles.campaignTitle}>{campaign.campaignName}</Text><Text style={styles.campaignSub}>Audience · {campaign.targetTier === 'ALL' ? 'All ad-supported viewers (VIP excluded)' : 'Free members'}</Text>{campaign.status === 'PENDING_REVIEW' && <Text style={styles.campaignSub}>Awaiting administrator review</Text>}{campaign.status === 'PAUSED' && <Text style={styles.campaignSub}>Paused by an administrator</Text>}{campaign.status === 'REJECTED' && <Text style={styles.campaignSub}>Not approved</Text>}</View><Text style={campaign.status === 'ACTIVE' ? styles.advertiserStatusActive : styles.advertiserStatusPaused}>{campaign.status === 'PENDING_REVIEW' ? 'PENDING REVIEW' : campaign.status}</Text></View>
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
function ProfileTabView({ profile, onSupport, onEngagement, onRefreshProfile, onUpgradeRole, onSignOut }: { profile: ViewerProfile; onSupport: () => void; onEngagement: () => void; onRefreshProfile: () => Promise<void>; onUpgradeRole: (role: 'CREATOR' | 'ADVERTISER') => Promise<void>; onSignOut: () => void }) {
  const roles = Array.from(new Set(profile.roles?.length ? profile.roles : [profile.role]));
  const missingRoles = profile.role === 'ADMIN' ? [] : (['CREATOR', 'ADVERTISER'] as const).filter(role => !roles.includes(role));
  const [message, setMessage] = useState('');
  const [busyPlan, setBusyPlan] = useState<'VIP_MONTHLY' | 'VIP_YEARLY' | null>(null);
  const [busyUpgrade, setBusyUpgrade] = useState<'CREATOR' | 'ADVERTISER' | null>(null);
  const [roleToConfirm, setRoleToConfirm] = useState<'CREATOR' | 'ADVERTISER' | null>(null);

  async function upgradeRole(role: 'CREATOR' | 'ADVERTISER') {
    setBusyUpgrade(role);
    setMessage('');
    try {
      await onUpgradeRole(role);
      setMessage(role === 'CREATOR' ? 'Your account is now registered as a content creator.' : 'Your account is now registered as an advertiser.');
      setRoleToConfirm(null);
      await onRefreshProfile();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update your account type.');
    } finally {
      setBusyUpgrade(null);
    }
  }

  async function refreshMembership() {
    try {
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
      setMessage('Complete payment in Stripe Checkout, return here, then refresh membership status.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to start checkout.');
    } finally {
      setBusyPlan(null);
    }
  }

  const accountType = profile.role === 'ADMIN'
    ? 'Administrator'
    : roles.includes('CREATOR') || roles.includes('ADVERTISER')
      ? roles.filter(role => role !== 'VIEWER').map(role => role === 'CREATOR' ? 'Creator' : 'Advertiser').join(' + ')
      : 'Basic user';

  return (
    <ScrollView contentContainerStyle={styles.profilePage}>
      <View style={styles.profilePageHeader}>
        <Text style={styles.profilePageTitle}>Profile</Text>
        <Text style={styles.profilePageSubtitle}>Manage your account</Text>
      </View>

      <View style={styles.profileHero}>
        <View style={styles.profileUserRow}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarLetter}>{profile.name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={styles.profileIdentity}>
            <View style={styles.profileNameLine}>
              <Text style={styles.profileName} numberOfLines={1}>{profile.name}</Text>
              <View style={styles.profileAccountStatus}>
                <View style={styles.profileAccountStatusDot} />
                <Text style={styles.profileAccountStatusText}>Active</Text>
              </View>
            </View>
            <Text style={styles.profileEmail} numberOfLines={1}>{profile.email}</Text>
          </View>
        </View>
        <View style={styles.profileHeroDivider} />
        <View style={styles.profileStatusRow}>
          <View style={styles.profileMetaColumn}>
            <Text style={styles.profileMetaLabel}>MEMBERSHIP</Text>
            <Text style={[styles.profileMetaValue, profile.isVip && styles.profileVipValue]}>{profile.isVip ? 'VIP' : 'Free'}</Text>
          </View>
          <View style={styles.profileMetaColumn}>
            <Text style={styles.profileMetaLabel}>ACCOUNT TYPE</Text>
            <Text style={styles.profileMetaValue} numberOfLines={2}>{accountType}</Text>
          </View>
        </View>
      </View>

      {missingRoles.length > 0 && (
        <View style={styles.profileSection}>
          <Text style={styles.profileSectionTitle}>More ways to use Global Station</Text>
          <View style={styles.profileRoleGrid}>
            {missingRoles.includes('CREATOR') && <TouchableOpacity accessibilityRole="button" style={styles.profileRoleCard} disabled={busyUpgrade !== null} onPress={() => { setMessage(''); setRoleToConfirm('CREATOR'); }}>
              <Text style={styles.profileRoleIcon}>✦</Text>
              <Text style={styles.profileRoleTitle}>Be a Creator</Text>
              <Text style={styles.profileRoleArrow}>›</Text>
            </TouchableOpacity>}
            {missingRoles.includes('ADVERTISER') && <TouchableOpacity accessibilityRole="button" style={styles.profileRoleCard} disabled={busyUpgrade !== null} onPress={() => { setMessage(''); setRoleToConfirm('ADVERTISER'); }}>
              <Text style={styles.profileRoleIcon}>↗</Text>
              <Text style={styles.profileRoleTitle}>Be an Advertiser</Text>
              <Text style={styles.profileRoleArrow}>›</Text>
            </TouchableOpacity>}
          </View>
        </View>
      )}

      <View style={styles.profileSection}>
        <View style={styles.profileSectionHeading}>
          <Text style={styles.profileSectionTitle}>VIP membership</Text>
          {profile.isVip && <Text style={styles.profileActiveLabel}>ACTIVE</Text>}
        </View>
        <View style={styles.profilePlanGrid}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Monthly VIP membership, RM 14.90" style={styles.profilePlanCard} disabled={busyPlan !== null} onPress={() => beginCheckout('VIP_MONTHLY')}>
            <Text style={styles.profilePlanName}>Monthly</Text>
            <Text style={styles.profilePlanPrice}>RM 14.90</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Annual VIP membership, RM 119.90" style={styles.profilePlanCard} disabled={busyPlan !== null} onPress={() => beginCheckout('VIP_YEARLY')}>
            <Text style={styles.profilePlanName}>Annual</Text>
            <Text style={styles.profilePlanPrice}>RM 119.90</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity accessibilityRole="button" style={styles.profileRefreshButton} disabled={busyPlan !== null} onPress={refreshMembership}>
          <Text style={styles.profileRefreshText}>{busyPlan ? 'Opening checkout...' : 'Refresh membership status'}</Text>
        </TouchableOpacity>
      </View>

      {!!message && <Text style={styles.profileNotice}>{message}</Text>}

      <View style={styles.profileActions}>
        <TouchableOpacity accessibilityRole="button" style={styles.profileActionRow} onPress={onEngagement}>
          <View>
            <Text style={styles.profileActionTitle}>Notifications & referrals</Text>
            <Text style={styles.engagementActionSub}>Inbox, preferences and invite code</Text>
          </View>
          <Text style={styles.profileRoleArrow}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={styles.profileActionRow} onPress={onSupport}>
          <Text style={styles.profileActionTitle}>Contact support</Text>
          <Text style={styles.profileRoleArrow}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={[styles.profileActionRow, styles.profileSignOutRow]} onPress={onSignOut}>
          <Text style={styles.profileSignOutText}>Sign out</Text>
          <Text style={styles.profileRoleArrow}>›</Text>
        </TouchableOpacity>
      </View>
      <Modal visible={roleToConfirm !== null} transparent animationType="fade" onRequestClose={() => setRoleToConfirm(null)}>
        <View style={styles.selectModalBackdrop}>
          <View style={styles.selectModal}>
            <Text style={styles.selectModalTitle}>{roleToConfirm === 'CREATOR' ? 'Be a Creator?' : 'Be an Advertiser?'}</Text>
            <TouchableOpacity style={styles.cyanPrimaryBtn} disabled={busyUpgrade !== null} onPress={() => roleToConfirm && upgradeRole(roleToConfirm)}>
              <Text style={styles.cyanPrimaryBtnText}>{busyUpgrade ? 'Updating account...' : 'Confirm'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryFlowBtn} disabled={busyUpgrade !== null} onPress={() => setRoleToConfirm(null)}>
              <Text style={styles.secondaryFlowText}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function EngagementScreen({ profile, onBack, onLocationSharingChange }: { profile: ViewerProfile; onBack: () => void; onLocationSharingChange: (enabled: boolean) => Promise<void> }) {
  const [section, setSection] = useState<'inbox' | 'referrals' | 'preferences'>('inbox');
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [referral, setReferral] = useState<ReferralOverview | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    in_app: true,
    push: false,
    email: false,
    sms: false,
    whatsapp: false,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyLocation, setBusyLocation] = useState(false);
  const [savingPreference, setSavingPreference] = useState<keyof NotificationPreferences | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    const results = await Promise.allSettled([
      getNotifications(),
      getReferralOverview(),
      getNotificationPreferences(),
    ]);
    const failures: string[] = [];
    if (results[0].status === 'fulfilled') setNotifications(results[0].value);
    else failures.push(results[0].reason instanceof Error ? results[0].reason.message : 'Unable to load notifications.');
    if (results[1].status === 'fulfilled') setReferral(results[1].value);
    else failures.push(results[1].reason instanceof Error ? results[1].reason.message : 'Unable to load referral details.');
    if (results[2].status === 'fulfilled') setPreferences(results[2].value);
    else failures.push(results[2].reason instanceof Error ? results[2].reason.message : 'Unable to load notification preferences.');
    if (failures.length) setError(failures.join(' '));
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function readNotification(notification: InAppNotification) {
    if (notification.readAt) return;
    setBusy(true);
    setError('');
    try {
      await markNotificationRead(notification.id);
      const readAt = new Date().toISOString();
      setNotifications(current => current.map(item => item.id === notification.id
        ? { ...item, status: 'READ', readAt }
        : item));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to mark this notification as read.');
    } finally {
      setBusy(false);
    }
  }

  async function readAllNotifications() {
    setBusy(true);
    setError('');
    try {
      await markAllNotificationsRead();
      const readAt = new Date().toISOString();
      setNotifications(current => current.map(item => item.readAt ? item : { ...item, status: 'READ', readAt }));
      setNotice('All notifications marked as read.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update notifications.');
    } finally {
      setBusy(false);
    }
  }

  async function changePreference(key: keyof NotificationPreferences, enabled: boolean) {
    setSavingPreference(key);
    setError('');
    setNotice('');
    try {
      const updated = await updateNotificationPreferences({ [key]: enabled });
      setPreferences(updated);
      setNotice('Notification preference saved.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to save this preference.');
    } finally {
      setSavingPreference(null);
    }
  }

  function changeLocationSharing(enabled: boolean) {
    const save = async () => {
      setBusyLocation(true);
      setError('');
      setNotice('');
      try {
        if (enabled && !(await requestViewingLocationPermission())) {
          setNotice('Location permission was not granted.');
          return;
        }
        await onLocationSharingChange(enabled);
        setNotice(enabled ? 'Location sharing enabled.' : 'Location sharing turned off.');
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Unable to update location sharing.');
      } finally {
        setBusyLocation(false);
      }
    };
    if (!enabled) {
      void save();
      return;
    }
    Alert.alert(
      'Share approximate location?',
      'Your location is rounded to about 1 km. OpenStreetMap uses it to estimate your state or area, shown in admin audience analytics while you watch. You can turn this off in Preferences.',
      [{ text: 'Not now', style: 'cancel' }, { text: 'Continue', onPress: () => { void save(); } }],
    );
  }

  async function shareReferralCode() {
    if (!referral) return;
    try {
      await Share.share({
        message: `Join me on Global Station. Use my referral code ${referral.code} when you create your account.`,
      });
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : 'Unable to share your referral code.');
    }
  }

  const unreadCount = notifications.filter(item => !item.readAt).length;
  const referralCount = referral?.referrals.reduce((sum, item) => sum + item.count, 0) ?? 0;

  return <View style={styles.flowScreen}>
    <FlowHeader title="Engagement" onBack={onBack} />
    <ScrollView contentContainerStyle={styles.engagementPage}>
      <Text style={styles.screenMainTitle}>Stay connected</Text>
      <Text style={styles.screenSubTitle}>Notifications, invites and your reward history.</Text>

      <View style={styles.engagementTabs}>
        {([
          ['inbox', `Inbox${unreadCount ? ` · ${unreadCount}` : ''}`],
          ['referrals', 'Refer a friend'],
          ['preferences', 'Preferences'],
        ] as const).map(([key, label]) => (
          <TouchableOpacity key={key} accessibilityRole="button" accessibilityState={{ selected: section === key }}
            style={[styles.engagementTab, section === key && styles.engagementTabActive]}
            onPress={() => { setSection(key); setError(''); setNotice(''); }}>
            <Text style={[styles.engagementTabText, section === key && styles.engagementTabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!!error && <Text accessibilityRole="alert" style={styles.engagementError}>{error}</Text>}
      {!!notice && <Text style={styles.engagementNotice}>{notice}</Text>}
      {loading && <View style={styles.engagementLoading}><ActivityIndicator color={COLORS.cyan} /><Text style={styles.screenSubTitle}>Loading engagement details…</Text></View>}

      {!loading && section === 'inbox' && <>
        <View style={styles.engagementSectionHeading}>
          <View><Text style={styles.profileSectionTitle}>In-app notifications</Text><Text style={styles.screenSubTitle}>{notifications.length} recent</Text></View>
          <TouchableOpacity accessibilityRole="button" style={styles.secondaryFlowBtn} disabled={busy || unreadCount === 0} onPress={readAllNotifications}>
            <Text style={styles.secondaryFlowText}>{busy ? 'Updating…' : 'Mark all read'}</Text>
          </TouchableOpacity>
        </View>
        {notifications.length === 0
          ? <View style={styles.engagementEmpty}><Text style={styles.engagementEmptyTitle}>You’re all caught up</Text><Text style={styles.screenSubTitle}>New account updates and campaigns will show up here.</Text></View>
          : notifications.map(notification => <TouchableOpacity key={notification.id} accessibilityRole="button"
            accessibilityLabel={`${notification.title}${notification.readAt ? ', read' : ', unread'}`}
            disabled={busy || !!notification.readAt} onPress={() => readNotification(notification)}
            style={[styles.notificationCard, !notification.readAt && styles.notificationCardUnread]}>
            <View style={styles.notificationHeading}>
              <Text style={styles.notificationTitle}>{notification.title}</Text>
              {!notification.readAt && <View style={styles.notificationUnreadDot} />}
            </View>
            <Text style={styles.notificationBody}>{notification.body}</Text>
            <Text style={styles.notificationDate}>{formatDate(notification.createdAt)}{!notification.readAt ? ' · Tap to mark read' : ' · Read'}</Text>
          </TouchableOpacity>)}
      </>}

      {!loading && section === 'referrals' && <>
        <View style={styles.referralInviteCard}>
          <Text style={styles.referralInviteEyebrow}>YOUR INVITE CODE</Text>
          <Text selectable style={styles.referralInviteCode}>{referral?.code ?? 'Unavailable'}</Text>
          <Text style={styles.screenSubTitle}>Share your code with a friend. We’ll record the referral when they use it to create an account.</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.cyanPrimaryBtn} disabled={!referral} onPress={shareReferralCode}>
            <Text style={styles.cyanPrimaryBtnText}>Share referral code</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.referralStatsRow}>
          <View style={styles.referralStatCard}><Text style={styles.engagementStatValue}>{referralCount}</Text><Text style={styles.engagementStatLabel}>Sign-ups attributed</Text></View>
          <View style={styles.referralStatCard}><Text style={styles.engagementStatValue}>{referral?.rewards.length ?? 0}</Text><Text style={styles.engagementStatLabel}>Reward records</Text></View>
        </View>
        <Text style={[styles.profileSectionTitle, styles.engagementRewardsHeading]}>Referral activity</Text>
        {(referral?.referrals ?? []).length === 0
          ? <Text style={styles.engagementEmptyText}>Your referral activity will appear here.</Text>
          : referral?.referrals.map(item => <View key={item.status} style={styles.referralActivityRow}>
            <Text style={styles.notificationTitle}>{item.status.replace('_', ' ')}</Text><Text style={styles.engagementStatValue}>{item.count}</Text>
          </View>)}
        <Text style={[styles.profileSectionTitle, styles.engagementRewardsHeading]}>Rewards</Text>
        {(referral?.rewards ?? []).length === 0
          ? <Text style={styles.engagementEmptyText}>No rewards yet. Reward availability depends on future campaign terms.</Text>
          : referral?.rewards.map(reward => <View key={reward.id} style={styles.notificationCard}>
            <View style={styles.notificationHeading}><Text style={styles.notificationTitle}>{reward.rewardType.replaceAll('_', ' ')}</Text><Text style={styles.rewardStatus}>{reward.status}</Text></View>
            <Text style={styles.notificationBody}>{reward.amount}{reward.currency ? ` ${reward.currency}` : ''} · Created {formatDate(reward.createdAt)}</Text>
          </View>)}
        <Text style={styles.engagementFootnote}>Referral tracking is active. Discounts or subscription rewards are not automatically applied yet.</Text>
      </>}

      {!loading && section === 'preferences' && <>
        <Text style={styles.profileSectionTitle}>Choose your channels</Text>
        <Text style={styles.screenSubTitle}>Preferences are saved to your account. External delivery channels are not connected yet.</Text>
        {([
          ['in_app', 'In-app notifications', 'Updates in your Global Station inbox.'],
          ['push', 'Push notifications', 'Available after push service and device permissions are configured.'],
          ['email', 'Email', 'Email delivery provider is not connected yet.'],
          ['sms', 'SMS', 'SMS provider is not connected yet.'],
          ['whatsapp', 'WhatsApp', 'WhatsApp provider is not connected yet.'],
        ] as const).map(([key, title, description]) => (
          <View key={key} style={styles.preferenceRow}>
            <View style={styles.preferenceCopy}><Text style={styles.notificationTitle}>{title}</Text><Text style={styles.preferenceDescription}>{description}</Text></View>
            <Switch accessibilityLabel={`${title} preference`} value={preferences[key]} disabled={savingPreference !== null}
              onValueChange={enabled => changePreference(key, enabled)}
              trackColor={{ false: '#dce5df', true: COLORS.cyanDark }} thumbColor={preferences[key] ? COLORS.cyan : '#cbd5e1'} />
          </View>
        ))}
        <View style={{ marginTop: 24 }}>
          <Text style={styles.profileSectionTitle}>Viewing location</Text>
          <View style={styles.preferenceRow}>
            <View style={styles.preferenceCopy}><Text style={styles.notificationTitle}>Location</Text></View>
            <Switch accessibilityLabel="Share location" value={profile.locationAnalyticsEnabled} disabled={busyLocation}
              onValueChange={changeLocationSharing}
              trackColor={{ false: '#dce5df', true: COLORS.cyanDark }} thumbColor={profile.locationAnalyticsEnabled ? COLORS.cyan : '#cbd5e1'} />
          </View>
        </View>
      </>}

      {!loading && <TouchableOpacity accessibilityRole="button" style={styles.engagementRefresh} disabled={busy} onPress={refresh}>
        <Text style={styles.profileRefreshText}>Refresh</Text>
      </TouchableOpacity>}
    </ScrollView>
  </View>;
}

function FlowHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return <View style={styles.flowHeader}><TouchableOpacity onPress={onBack}><Text style={styles.backBtnText}>‹ Back</Text></TouchableOpacity><Text style={styles.flowHeaderTitle}>{title}</Text><View style={{ width: 48 }} /></View>;
}

function FlowField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return <View style={styles.flowField}><Text style={styles.flowLabel}>{label}</Text><TextInput value={value} editable={false} multiline={multiline} style={[styles.flowInput, multiline && styles.flowTextArea]} placeholderTextColor={COLORS.textDim} /></View>;
}

function AdBreak({ fullscreen, onComplete, onToggleFullscreen }: { fullscreen: boolean; onComplete: () => void; onToggleFullscreen: () => void }) {
  const [ad, setAd] = useState<AdPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adPaused, setAdPaused] = useState(false);
  const [adHasStarted, setAdHasStarted] = useState(false);
  const [adCurrentTime, setAdCurrentTime] = useState(0);
  const [adDuration, setAdDuration] = useState(0);
  const onCompleteRef = useRef(onComplete);
  const activeRef = useRef(true);
  const requestIdRef = useRef(0);
  const lastReportedAdSecond = useRef(-1);
  const completionReported = useRef(false);
  onCompleteRef.current = onComplete;

  function reportAdProgress(position: number, duration: number, completed = false) {
    if (!ad || duration <= 0 || (completed && completionReported.current)) return;
    const wholeSecond = Math.floor(position);
    if (!completed && wholeSecond - lastReportedAdSecond.current < 5) return;
    if (completed) completionReported.current = true;
    const previousSecond = lastReportedAdSecond.current;
    lastReportedAdSecond.current = wholeSecond;
    recordAdProgress(ad.impressionId, wholeSecond, Math.floor(duration), completed).catch((requestError) => {
      lastReportedAdSecond.current = previousSecond;
      if (activeRef.current) {
        setError(requestError instanceof Error ? requestError.message : 'Unable to record ad playback.');
      }
    });
  }

  async function openAdvertiserPage() {
    if (!ad?.clickThroughUrl) return;
    try {
      await recordAdClick(ad.impressionId);
      await Linking.openURL(ad.clickThroughUrl);
    } catch {
      Alert.alert('Unable to open link', 'The advertiser click could not be recorded or the page could not be opened.');
    }
  }

  const loadAd = useCallback(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setAd(null);
    setAdHasStarted(false);
    setAdCurrentTime(0);
    setAdDuration(0);
    getAdPayload().then((payload) => {
      if (!activeRef.current || requestId !== requestIdRef.current) return;
      if (!payload) onCompleteRef.current();
      else {
        lastReportedAdSecond.current = -1;
        completionReported.current = false;
        setAdPaused(false);
        setAd(payload);
      }
    }).catch((requestError) => {
      if (activeRef.current && requestId === requestIdRef.current) {
        setError(requestError instanceof Error ? requestError.message : 'Unable to load an ad.');
      }
    }).finally(() => {
      if (activeRef.current && requestId === requestIdRef.current) setLoading(false);
    });
  }, []);

  useEffect(() => {
    activeRef.current = true;
    loadAd();
    return () => {
      activeRef.current = false;
      requestIdRef.current += 1;
    };
  }, [loadAd]);

  if (error) return <View style={[StyleSheet.absoluteFill, styles.adErrorBackdrop]}>
    <View style={styles.adCard}>
      <Text style={styles.adTitle}>Ad unavailable</Text>
      <Text style={styles.adErrorText}>{error}</Text>
      <View style={styles.adActionRow}>
        <TouchableOpacity onPress={loadAd}><Text style={styles.learnMoreText}>Retry</Text></TouchableOpacity>
        <TouchableOpacity style={styles.skipBtn} onPress={() => onCompleteRef.current()}><Text style={styles.skipBtnText}>Continue</Text></TouchableOpacity>
      </View>
    </View>
  </View>;
  if (loading || !ad) return <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.adLoading]}>
    <ActivityIndicator color={COLORS.cyan} />
    <Text style={styles.adLoadingText}>Loading ad…</Text>
  </View>;
  const adProgress = adDuration > 0 ? Math.min(100, adCurrentTime / adDuration * 100) : 0;
  const secondsUntilSkip = Math.max(0, 5 - Math.floor(adCurrentTime));
  const formatAdTime = (seconds: number) => {
    const wholeSeconds = Math.max(0, Math.floor(seconds));
    return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`;
  };
  const advertiserDomain = ad.clickThroughUrl ? new URL(ad.clickThroughUrl).hostname.replace(/^www\./, '') : '';

  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    <Video
      source={{ uri: ad.creativeVideoUrl }}
      paused={adPaused}
      muted={false}
      volume={1}
      audioOutput="speaker"
      ignoreSilentSwitch="ignore"
      controls={false}
      resizeMode="contain"
      viewType={ViewType.TEXTURE}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLoad={({ duration }) => { setAdDuration(duration); reportAdProgress(0, duration); }}
      onProgress={({ currentTime }) => {
        setAdCurrentTime(currentTime);
        if (currentTime > 0) setAdHasStarted(true);
        reportAdProgress(currentTime, adDuration);
      }}
      onEnd={() => { reportAdProgress(adDuration, adDuration, true); onCompleteRef.current(); }}
      onError={() => setError('The ad video could not be played.')}
    />
    <View pointerEvents="box-none" style={styles.adPlayerOverlay}>
      <View style={styles.adBrandOverlay}>
        <View style={styles.adBrandMark}><Text style={styles.adBrandInitial}>{ad.title.trim().charAt(0).toUpperCase() || 'A'}</Text></View>
        <View style={styles.adBrandCopy}>
          <Text style={styles.adTitle} numberOfLines={1}>{ad.title}</Text>
          <Text style={styles.adBrandLabel}>Sponsored</Text>
        </View>
      </View>
      <View style={styles.adControlsOverlay}>
        <View style={styles.adProgressTrack}>
          <View style={[styles.adProgressFill, { width: `${adProgress}%` }]} />
        </View>
        <View style={styles.adControlsRow}>
          <View style={styles.adPlaybackControls}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={adPaused ? 'Play ad' : 'Pause ad'} onPress={() => setAdPaused(paused => !paused)} style={styles.adPlayButton}>
              <Text style={styles.adPlayButtonText}>{adPaused ? '▶' : 'Ⅱ'}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={fullscreen ? 'Exit ad full screen' : 'View ad full screen'} onPress={onToggleFullscreen} style={styles.adPlayButton}>
              <Text style={styles.adFullscreenButtonText}>{fullscreen ? '×' : '⛶'}</Text>
            </TouchableOpacity>
            <Text style={styles.adTimeText}>Ad · {formatAdTime(adCurrentTime)} / {formatAdTime(adDuration)}</Text>
          </View>
          <View style={styles.adActionRow}>
            {ad.clickThroughUrl && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Visit Page" style={styles.adVisitButton} onPress={openAdvertiserPage}><Text style={styles.adVisitButtonText}>Visit Page</Text></TouchableOpacity>}
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={!adHasStarted ? 'Skip ad unavailable until playback starts' : secondsUntilSkip > 0 ? `Skip ad in ${secondsUntilSkip} seconds` : 'Skip ad'} style={[styles.skipBtn, styles.adSkipButton]} disabled={!adHasStarted || secondsUntilSkip > 0} onPress={() => onCompleteRef.current()}><Text style={styles.skipBtnText}>{!adHasStarted ? 'Starting…' : secondsUntilSkip > 0 ? `Skip in ${secondsUntilSkip}s` : 'Skip ad'}</Text></TouchableOpacity>
          </View>
        </View>
        {!!advertiserDomain && <Text style={styles.adDestination} numberOfLines={1}>{advertiserDomain}</Text>}
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

function MultiSelectField({ label, values, options, onChange }: { label: string; values: string[]; options: string[]; onChange: (values: string[]) => void }) {
  const [visible, setVisible] = useState(false);
  const toggleOption = (option: string) => {
    onChange(values.includes(option) ? values.filter((value) => value !== option) : [...values, option]);
  };

  return <View style={styles.flowField}>
    <Text style={styles.flowLabel}>{label}</Text>
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${values.length ? values.join(', ') : 'none selected'}`}
      accessibilityState={{ expanded: visible }}
      style={styles.selectField}
      onPress={() => setVisible(true)}
    >
      <Text style={values.length ? styles.selectValue : styles.multiSelectPlaceholder} numberOfLines={2}>
        {values.length ? values.join(', ') : 'Choose one or more'}
      </Text>
      <Text style={styles.selectChevron}>⌄</Text>
    </TouchableOpacity>
    <Text style={styles.multiSelectHint}>Choose one or more genres.</Text>
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={styles.selectModalBackdrop}>
        <View style={styles.selectModal}>
          <Text style={styles.selectModalTitle}>{label}</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {options.map((option) => {
              const selected = values.includes(option);
              return <TouchableOpacity
                key={option}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                style={styles.selectOption}
                onPress={() => toggleOption(option)}
              >
                <Text style={[styles.selectOptionText, selected && styles.selectOptionTextSelected]}>{option}</Text>
                {selected && <Text style={styles.selectCheck}>✓</Text>}
              </TouchableOpacity>;
            })}
          </ScrollView>
          <TouchableOpacity style={styles.secondaryFlowBtn} onPress={() => setVisible(false)}>
            <Text style={styles.secondaryFlowText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  </View>;
}

type CreatorVideoFile = { path: string; name: string; size: number };
type CreatorPosterFile = CreatorVideoFile & { contentType: string };

async function pickCreatorPoster(): Promise<CreatorPosterFile> {
  const [picked] = await pick({ type: [types.images], mode: 'import' });
  const name = picked.name?.trim() || decodeURIComponent(picked.uri.split('/').pop()?.split('?')[0] ?? 'poster');
  const extension = name.toLowerCase().split('.').pop();
  const extensionTypes: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const reportedType = picked.type?.toLowerCase() === 'image/jpg' ? 'image/jpeg' : picked.type?.toLowerCase();
  const contentType = reportedType && ['image/jpeg', 'image/png', 'image/webp'].includes(reportedType)
    ? reportedType
    : extensionTypes[extension ?? ''];
  if (!contentType) throw new Error('Choose a JPEG, PNG, or WebP poster image.');
  const [copy] = await keepLocalCopy({ files: [{ uri: picked.uri, fileName: name }], destination: 'cachesDirectory' });
  if (copy.status !== 'success') throw new Error(copy.copyError || 'Unable to access the selected poster.');
  const path = copy.localUri.replace(/^file:\/\//, '');
  const file = await ReactNativeBlobUtil.fs.stat(path);
  const size = picked.size && picked.size > 0 ? picked.size : Number(file.size);
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('The selected poster file is empty or unreadable.');
  if (size > 10 * 1024 * 1024) throw new Error('Poster images must be 10 MB or smaller.');
  return { path, name, size, contentType };
}

async function uploadCreatorPoster(poster: CreatorPosterFile, onProgress?: (progress: number) => void) {
  const upload = await createCreatorPosterUpload(poster.contentType, poster.size);
  const result = await ReactNativeBlobUtil.fetch('PUT', upload.uploadUrl,
    { 'Content-Type': upload.contentType, ...upload.requiredHeaders },
    ReactNativeBlobUtil.wrap(poster.path))
    .uploadProgress({ interval: 500 }, (written, total) => onProgress?.(Math.round(written / Math.max(1, total) * 100)));
  if (result.info().status < 200 || result.info().status >= 300) {
    throw new Error(`Poster upload failed (${result.info().status}).`);
  }
  return upload.objectKey;
}

function UploadScreen({ onBack }: { onBack: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState<string[]>(['Drama']);
  const [category, setCategory] = useState('Malay Drama');
  const [rating, setRating] = useState('P13');
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [durationSeconds, setDurationSeconds] = useState('');
  const [contentType, setContentType] = useState<'MOVIE' | 'SERIES'>('SERIES');
  const [isExclusiveVip, setIsExclusiveVip] = useState(false);
  const [video, setVideo] = useState<{ path: string; name: string; size: number } | null>(null);
  const [poster, setPoster] = useState<CreatorPosterFile | null>(null);
  const [posterHorizontal, setPosterHorizontal] = useState<CreatorPosterFile | null>(null);
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

  async function choosePoster(setPosterFile: (file: CreatorPosterFile) => void) {
    setNotice('');
    try {
      setPosterFile(await pickCreatorPoster());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to select poster image.');
    }
  }

  async function submit() {
    if (!video || !poster || !posterHorizontal) { setNotice('Select an MP4 video and both vertical and horizontal posters first.'); return; }
    if (!title.trim() || !description.trim() || genre.length === 0 || !category || (contentType === 'SERIES' && !episodeTitle.trim()) || !Number.isSafeInteger(Number(durationSeconds)) || Number(durationSeconds) <= 0) {
      setNotice('Complete all content details before submitting.');
      return;
    }
    setBusy(true);
    setNotice('');
    setProgress(0);
    try {
      const posterHorizontalKey = await uploadCreatorPoster(posterHorizontal,
        amount => setProgress(Math.round(amount * 0.1)));
      const posterKey = await uploadCreatorPoster(poster,
        amount => setProgress(10 + Math.round(amount * 0.1)));

      const upload = await createCreatorUpload(video.size);
      const result = await ReactNativeBlobUtil.fetch('PUT', upload.uploadUrl, { 'Content-Type': upload.contentType }, ReactNativeBlobUtil.wrap(video.path))
        .uploadProgress({ interval: 500 }, (written, total) => setProgress(Math.min(100, 20 + Math.round(written / Math.max(1, total) * 80))));
      if (result.info().status < 200 || result.info().status >= 300) throw new Error(`Video upload failed (${result.info().status}).`);
      await submitCreatorContent({ title: title.trim(), contentType, description: description.trim(), posterKey, posterHorizontalKey, rating, genre, category, episodeTitle: contentType === 'MOVIE' ? title.trim() : episodeTitle.trim(), durationSeconds: Number(durationSeconds), mediaKey: upload.objectKey, isExclusiveVip });
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
    <Text style={styles.screenSubTitle}>Submit an MP4 with vertical and horizontal posters. Content is reviewed before it appears in the catalog.</Text>
    <TouchableOpacity style={styles.secondaryFlowBtn} disabled={busy} onPress={chooseVideo}><Text style={styles.secondaryFlowText}>{video ? `${video.name} • ${(video.size / 1048576).toFixed(1)} MB` : 'Choose MP4 video'}</Text></TouchableOpacity>
    <TouchableOpacity style={styles.secondaryFlowBtn} disabled={busy} onPress={() => choosePoster(setPoster)}><Text style={styles.secondaryFlowText}>{poster ? `Vertical poster · ${poster.name} • ${(poster.size / 1048576).toFixed(1)} MB` : 'Choose vertical poster (portrait)'}</Text></TouchableOpacity>
    <TouchableOpacity style={styles.secondaryFlowBtn} disabled={busy} onPress={() => choosePoster(setPosterHorizontal)}><Text style={styles.secondaryFlowText}>{posterHorizontal ? `Horizontal poster · ${posterHorizontal.name} • ${(posterHorizontal.size / 1048576).toFixed(1)} MB` : 'Choose horizontal poster (landscape)'}</Text></TouchableOpacity>
    <View style={styles.heroBtnRow}>{(['SERIES', 'MOVIE'] as const).map((type) => <TouchableOpacity key={type} disabled={busy} style={[styles.chip, contentType === type && styles.chipActive]} onPress={() => setContentType(type)}><Text style={[styles.chipText, contentType === type && styles.chipTextActive]}>{type}</Text></TouchableOpacity>)}</View>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Title</Text><TextInput value={title} onChangeText={setTitle} editable={!busy} maxLength={255} style={styles.flowInput} /></View>
    {contentType === 'SERIES' && <View style={styles.flowField}><Text style={styles.flowLabel}>First episode title</Text><TextInput value={episodeTitle} onChangeText={setEpisodeTitle} editable={!busy} maxLength={255} style={styles.flowInput} /></View>}
    <View style={styles.flowField}><Text style={styles.flowLabel}>Synopsis</Text><TextInput value={description} onChangeText={setDescription} editable={!busy} maxLength={5000} style={[styles.flowInput, styles.flowTextArea]} multiline textAlignVertical="top" /></View>
    <MultiSelectField label="Genre" values={genre} options={[...CONTENT_GENRES]} onChange={setGenre} />
    <SelectField label="Category" value={category} options={[...CONTENT_CATEGORIES]} onChange={setCategory} />
    <SelectField label="Rating" value={rating} options={['U', 'P12', 'P13', '16', '18']} onChange={setRating} />
    <View style={styles.flowField}><Text style={styles.flowLabel}>Duration (seconds)</Text><TextInput value={durationSeconds} onChangeText={setDurationSeconds} editable={!busy} style={styles.flowInput} keyboardType="number-pad" /></View>
    <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: isExclusiveVip }} style={styles.secondaryFlowBtn} disabled={busy} onPress={() => setIsExclusiveVip(!isExclusiveVip)}><Text style={styles.secondaryFlowText}>{isExclusiveVip ? '☑ VIP exclusive' : '☐ VIP exclusive'}</Text></TouchableOpacity>
    {busy && <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={styles.uploadProgress}><View style={[styles.uploadProgressFill, { width: `${progress}%` }]} /></View>}
    {busy && <Text style={styles.screenSubTitle}>Uploading posters and video: {progress}%</Text>}
    {!!notice && <Text style={[styles.screenSubTitle, { marginTop: 12 }]}>{notice}</Text>}
    <TouchableOpacity style={styles.cyanPrimaryBtn} disabled={busy} onPress={submit}><Text style={styles.cyanPrimaryBtnText}>{busy ? 'Uploading...' : 'Upload and submit for review'}</Text></TouchableOpacity>
  </ScrollView></View>;
}

async function uploadCreatorVideoFile(video: CreatorVideoFile, onProgress: (progress: number) => void) {
  const upload = await createCreatorUpload(video.size);
  const result = await ReactNativeBlobUtil.fetch('PUT', upload.uploadUrl, { 'Content-Type': upload.contentType }, ReactNativeBlobUtil.wrap(video.path))
    .uploadProgress({ interval: 500 }, (written, total) => onProgress(Math.min(100, Math.round(written / Math.max(1, total) * 100))));
  if (result.info().status < 200 || result.info().status >= 300) throw new Error(`Video upload failed (${result.info().status}).`);
  return upload.objectKey;
}

function AddCreatorEpisodeScreen({ submission, onBack, onSaved }: {
  submission: CreatorSubmission;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [durationSeconds, setDurationSeconds] = useState('');
  const [video, setVideo] = useState<CreatorVideoFile | null>(null);
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

  async function submit() {
    const duration = Number(durationSeconds);
    if (!video || !title.trim() || !Number.isSafeInteger(duration) || duration <= 0) {
      setNotice('Choose an MP4, enter an episode title, and provide its duration in seconds.');
      return;
    }
    setBusy(true);
    setNotice('');
    setProgress(0);
    try {
      const mediaKey = await uploadCreatorVideoFile(video, setProgress);
      const result = await addCreatorEpisode(submission.id, { title: title.trim(), durationSeconds: duration, mediaKey });
      Alert.alert('Episode submitted', `Episode ${result.episodeNumber} was added to “${submission.title}” and the series was sent for review.`);
      onSaved();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to submit episode.');
    } finally {
      setBusy(false);
    }
  }

  return <View style={styles.flowScreen}>
    <FlowHeader title="Add episode" onBack={onBack} />
    <ScrollView contentContainerStyle={styles.flowContent}>
      <Text style={styles.screenMainTitle}>Add to {submission.title}</Text>
      <Text style={styles.screenSubTitle}>Next episode number: {submission.episodeCount + 1}. New episodes are reviewed before they are published.</Text>
      <View style={styles.flowField}>
        <Text style={styles.flowLabel}>Episode title</Text>
        <TextInput value={title} onChangeText={setTitle} editable={!busy} maxLength={255} placeholder="Enter an episode title" placeholderTextColor={COLORS.textDim} style={styles.flowInput} />
      </View>
      <View style={styles.flowField}>
        <Text style={styles.flowLabel}>Video</Text>
        <TouchableOpacity style={styles.secondaryFlowBtn} disabled={busy} onPress={chooseVideo}>
          <Text style={styles.secondaryFlowText}>{video ? `${video.name} • ${(video.size / 1048576).toFixed(1)} MB` : 'Choose MP4 video'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.flowField}>
        <Text style={styles.flowLabel}>Duration (seconds)</Text>
        <TextInput value={durationSeconds} onChangeText={setDurationSeconds} editable={!busy} keyboardType="number-pad" placeholder="e.g. 1200" placeholderTextColor={COLORS.textDim} style={styles.flowInput} />
      </View>
      {busy && <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={styles.uploadProgress}><View style={[styles.uploadProgressFill, { width: `${progress}%` }]} /></View>}
      {busy && <Text style={styles.screenSubTitle}>Uploading episode: {progress}%</Text>}
      {!!notice && <Text style={[styles.screenSubTitle, { marginTop: 12 }]}>{notice}</Text>}
      <TouchableOpacity style={styles.cyanPrimaryBtn} disabled={busy} onPress={submit}>
        <Text style={styles.cyanPrimaryBtnText}>{busy ? 'Uploading episode…' : 'Submit episode for review'}</Text>
      </TouchableOpacity>
    </ScrollView>
  </View>;
}

function EditCreatorContentScreen({ submission, onBack, onSaved }: {
  submission: CreatorSubmission;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(submission.title);
  const [description, setDescription] = useState(submission.description);
  const [genre, setGenre] = useState(submission.genre.split(',').map((value) => value.trim()).filter(Boolean));
  const [category, setCategory] = useState(submission.category);
  const [rating, setRating] = useState(submission.rating);
  const [isExclusiveVip, setIsExclusiveVip] = useState(submission.isExclusiveVip);
  const [poster, setPoster] = useState<CreatorPosterFile | null>(null);
  const [posterHorizontal, setPosterHorizontal] = useState<CreatorPosterFile | null>(null);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function choosePoster(setPosterFile: (file: CreatorPosterFile) => void) {
    setNotice('');
    try {
      setPosterFile(await pickCreatorPoster());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to select poster image.');
    }
  }

  async function submit() {
    if (title.trim().length < 2 || description.trim().length < 10) {
      setNotice('Enter a title and synopsis of at least 10 characters.');
      return;
    }
    setBusy(true);
    setNotice('');
    setProgress(0);
    try {
      let posterKey: string | undefined;
      let posterHorizontalKey: string | undefined;
      if (poster) {
        posterKey = await uploadCreatorPoster(poster, amount => setProgress(Math.round(amount * (posterHorizontal ? 0.2 : 0.4))));
      }
      if (posterHorizontal) {
        posterHorizontalKey = await uploadCreatorPoster(posterHorizontal,
          amount => setProgress((poster ? 40 : 0) + Math.round(amount * 0.4)));
      }
      await updateCreatorContent(submission.id, {
        title: title.trim(),
        description: description.trim(),
        rating,
        genre,
        category,
        isExclusiveVip,
        ...(posterKey ? { posterKey } : {}),
        ...(posterHorizontalKey ? { posterHorizontalKey } : {}),
      });
      Alert.alert('Changes submitted', 'Your content changes are saved and have been sent for review.');
      onSaved();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to update content.');
    } finally {
      setBusy(false);
    }
  }

  return <View style={styles.flowScreen}>
    <FlowHeader title="Edit content" onBack={onBack} />
    <ScrollView contentContainerStyle={styles.flowContent}>
      <Text style={styles.screenMainTitle}>Edit {submission.contentType === 'SERIES' ? 'series' : 'movie'}</Text>
      <Text style={styles.screenSubTitle}>Saved changes will be reviewed before the title returns to viewers.</Text>
      <View style={styles.flowField}>
        <Text style={styles.flowLabel}>Title</Text>
        <TextInput value={title} onChangeText={setTitle} editable={!busy} maxLength={255} style={styles.flowInput} />
      </View>
      <View style={styles.flowField}>
        <Text style={styles.flowLabel}>Synopsis</Text>
        <TextInput value={description} onChangeText={setDescription} editable={!busy} maxLength={5000} style={[styles.flowInput, styles.flowTextArea]} multiline textAlignVertical="top" />
      </View>
      <MultiSelectField label="Genre" values={genre} options={[...CONTENT_GENRES]} onChange={setGenre} />
      <SelectField label="Category" value={category} options={[...CONTENT_CATEGORIES]} onChange={setCategory} />
      <SelectField label="Rating" value={rating} options={['U', 'P12', 'P13', '16', '18']} onChange={setRating} />
      <TouchableOpacity style={styles.secondaryFlowBtn} disabled={busy} onPress={() => choosePoster(setPoster)}>
        <Text style={styles.secondaryFlowText}>{poster ? `New vertical poster · ${poster.name} • ${(poster.size / 1048576).toFixed(1)} MB` : 'Change vertical poster (optional)'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryFlowBtn} disabled={busy} onPress={() => choosePoster(setPosterHorizontal)}>
        <Text style={styles.secondaryFlowText}>{posterHorizontal ? `New horizontal poster · ${posterHorizontal.name} • ${(posterHorizontal.size / 1048576).toFixed(1)} MB` : 'Change horizontal poster (optional)'}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: isExclusiveVip }} style={styles.secondaryFlowBtn} disabled={busy} onPress={() => setIsExclusiveVip(!isExclusiveVip)}>
        <Text style={styles.secondaryFlowText}>{isExclusiveVip ? '☑ VIP exclusive' : '☐ VIP exclusive'}</Text>
      </TouchableOpacity>
      {busy && <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={styles.uploadProgress}><View style={[styles.uploadProgressFill, { width: `${progress}%` }]} /></View>}
      {!!notice && <Text style={[styles.screenSubTitle, { marginTop: 12 }]}>{notice}</Text>}
      <TouchableOpacity style={styles.cyanPrimaryBtn} disabled={busy} onPress={submit}>
        <Text style={styles.cyanPrimaryBtnText}>{busy ? 'Saving changes…' : 'Save and submit for review'}</Text>
      </TouchableOpacity>
    </ScrollView>
  </View>;
}

function CampaignScreen({ onBack }: { onBack: () => void }) {
  const [campaignName, setCampaignName] = useState('');
  const [clickThroughUrl, setClickThroughUrl] = useState('');
  const [cpmRate, setCpmRate] = useState(10);
  const [totalBudget, setTotalBudget] = useState(500);
  const targetTier: 'FREE' = 'FREE';
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
    if (campaignName.trim().length < 2) { setNotice('Enter a campaign name with at least 2 characters.'); return; }
    let destination: URL;
    try {
      destination = new URL(clickThroughUrl.trim());
    } catch {
      setNotice('Enter a valid HTTPS destination URL.');
      return;
    }
    if (destination.protocol !== 'https:') { setNotice('Enter a secure HTTPS destination URL.'); return; }
    setBusy(true);
    setNotice('');
    setProgress(0);
    try {
      const upload = await createAdvertiserUpload(creative.size);
      const result = await ReactNativeBlobUtil.fetch('PUT', upload.uploadUrl, { 'Content-Type': upload.contentType }, ReactNativeBlobUtil.wrap(creative.path))
        .uploadProgress({ interval: 500 }, (written, total) => setProgress(Math.min(100, Math.round(written / Math.max(1, total) * 100))));
      if (result.info().status < 200 || result.info().status >= 300) throw new Error(`Creative upload failed (${result.info().status}).`);
      await createAdvertiserCampaign({ campaignName: campaignName.trim(), creativeKey: upload.objectKey, clickThroughUrl: destination.toString(), cpmRate, totalBudget, targetTier });
      Alert.alert('Campaign submitted', `Estimated delivery: ${Math.floor(totalBudget / cpmRate * 1000).toLocaleString()} impressions. It will reach viewers after an administrator activates it.`);
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
    <View style={styles.flowField}><Text style={styles.flowLabel}>Campaign name</Text><TextInput value={campaignName} onChangeText={setCampaignName} editable={!busy} maxLength={150} placeholder="Enter a campaign name" placeholderTextColor={COLORS.textDim} style={styles.flowInput} /></View>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Video creative</Text><TouchableOpacity style={styles.creativePicker} disabled={busy} onPress={chooseCreative}><Text style={styles.creativePickerIcon}>▶</Text><View style={{ flex: 1 }}><Text style={styles.creativePickerTitle}>{creative?.name ?? 'Choose MP4 video'}</Text><Text style={styles.creativePickerSub}>{creative ? `${(creative.size / 1048576).toFixed(1)} MB` : 'Upload a video ad from this device'}</Text></View><Text style={styles.creativePickerAction}>{creative ? 'Change' : 'Browse'}</Text></TouchableOpacity></View>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Destination link</Text><TextInput value={clickThroughUrl} onChangeText={setClickThroughUrl} editable={!busy} autoCapitalize="none" keyboardType="url" placeholder="https://your-site.com" placeholderTextColor={COLORS.textDim} style={styles.flowInput} /></View>
    <View style={styles.campaignChoiceSection}><Text style={styles.flowLabel}>Audience</Text><Text style={styles.campaignPickerHint}>Free members only. VIP membership is ad-free.</Text></View>
    <View style={styles.campaignChoiceSection}><Text style={styles.flowLabel}>CPM · cost per 1,000 impressions</Text><View style={styles.campaignChoiceRow}>{[5, 10, 20, 30].map(rate => <TouchableOpacity key={rate} disabled={busy} style={[styles.campaignChoice, cpmRate === rate && styles.campaignChoiceActive]} onPress={() => setCpmRate(rate)}><Text style={[styles.campaignChoiceLabel, cpmRate === rate && styles.campaignChoiceLabelActive]}>RM {rate}</Text></TouchableOpacity>)}</View></View>
    <View style={styles.campaignChoiceSection}><View style={styles.campaignBudgetHeader}><Text style={styles.flowLabel}>Total budget</Text><Text style={styles.campaignBudgetAmount}>RM {totalBudget.toLocaleString()}</Text></View><View style={styles.campaignChoiceRow}>{[100, 250, 500, 1000, 2500].map(amount => <TouchableOpacity key={amount} disabled={busy} style={[styles.campaignChoice, totalBudget === amount && styles.campaignChoiceActive]} onPress={() => setTotalBudget(amount)}><Text style={[styles.campaignChoiceLabel, totalBudget === amount && styles.campaignChoiceLabelActive]}>{amount >= 1000 ? `RM ${(amount / 1000).toFixed(amount % 1000 ? 1 : 0)}k` : `RM ${amount}`}</Text></TouchableOpacity>)}</View><View style={styles.budgetStepper}><Text style={styles.campaignPickerHint}>Adjust in RM 50 steps</Text><View style={styles.stepperControls}><TouchableOpacity accessibilityLabel="Decrease budget by RM 50" disabled={busy || totalBudget <= 50} style={styles.stepperButton} onPress={() => setTotalBudget(value => Math.max(50, value - 50))}><Text style={styles.stepperButtonText}>−</Text></TouchableOpacity><Text style={styles.stepperValue}>RM {totalBudget.toLocaleString()}</Text><TouchableOpacity accessibilityLabel="Increase budget by RM 50" disabled={busy} style={styles.stepperButton} onPress={() => setTotalBudget(value => Math.min(10000, value + 50))}><Text style={styles.stepperButtonText}>+</Text></TouchableOpacity></View></View></View>
    <View style={styles.reachEstimate}><Text style={styles.reachEstimateLabel}>Estimated ad impressions</Text><Text style={styles.reachEstimateValue}>{estimatedImpressions.toLocaleString()}</Text><Text style={styles.reachEstimateFootnote}>RM {totalBudget.toLocaleString()} budget ÷ RM {cpmRate} CPM · estimate, not guaranteed unique people</Text></View>
    {busy && <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={styles.uploadProgress}><View style={[styles.uploadProgressFill, { width: `${progress}%` }]} /></View>}
    {busy && <Text style={styles.screenSubTitle}>Uploading campaign video: {progress}%</Text>}
    {!!notice && <Text style={[styles.screenSubTitle, { marginTop: 12 }]}>{notice}</Text>}
    <TouchableOpacity style={styles.cyanPrimaryBtn} disabled={busy} onPress={submit}><Text style={styles.cyanPrimaryBtnText}>{busy ? 'Uploading and submitting…' : 'Submit campaign for review'}</Text></TouchableOpacity>
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
    {tickets.map((ticket) => <View key={ticket.id} style={styles.pipelineCard}><View style={{ flex: 1 }}><Text style={styles.pipelineTitle}>{ticket.subject}</Text><Text style={styles.pipelineSub}>{ticket.status.replace('_', ' ')} • {formatDate(ticket.createdAt)}</Text><Text style={styles.pipelineSub}>{ticket.description}</Text></View></View>)}
    {!tickets.length && <Text style={styles.screenSubTitle}>No support requests yet.</Text>}
  </ScrollView></View>;
}

// --- STYLESHEET ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  flowScreen: { flex: 1, backgroundColor: COLORS.bg },
  flowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderColor: COLORS.cardBorder },
  flowHeaderTitle: { color: COLORS.textLight, fontSize: 14, fontWeight: '800' },
  flowContent: { padding: 16, paddingBottom: 100 },
  flowMetric: { backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 10, padding: 16, marginTop: 16 },
  flowField: { marginTop: 14 },
  flowLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', marginBottom: 6 },
  flowInput: { minHeight: 44, backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 7, color: COLORS.textLight, paddingHorizontal: 12, paddingVertical: 10, fontSize: 12 },
  flowTextArea: { minHeight: 76, textAlignVertical: 'top' },
  selectField: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 7, paddingHorizontal: 12 },
  selectValue: { color: COLORS.textLight, fontSize: 12 },
  multiSelectPlaceholder: { color: COLORS.textDim, fontSize: 12 },
  multiSelectHint: { color: COLORS.textDim, fontSize: 11, marginTop: 5 },
  selectChevron: { color: COLORS.cyan, fontSize: 18, fontWeight: '800' },
  selectModalBackdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.72)' },
  selectModal: { maxHeight: '80%', backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 10, padding: 16 },
  selectModalTitle: { color: COLORS.textLight, fontSize: 16, fontWeight: '800', marginBottom: 8 },
  selectOption: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder, paddingHorizontal: 8 },
  selectOptionText: { color: COLORS.textLight, fontSize: 13 },
  selectOptionTextSelected: { color: COLORS.cyan, fontWeight: '800' },
  selectCheck: { color: COLORS.cyan, fontSize: 16, fontWeight: '900' },
  uploadProgress: { height: 5, backgroundColor: COLORS.cardBorder, borderRadius: 3, overflow: 'hidden', marginTop: 16 },
  uploadProgressFill: { height: '100%', backgroundColor: COLORS.cyan },
  supportChat: { backgroundColor: COLORS.cyanSoft, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 9, padding: 14, marginTop: 18 },
  chatAgent: { color: COLORS.cyan, fontSize: 11, fontWeight: '800' },
  chatMessage: { color: COLORS.textLight, fontSize: 12, marginTop: 8, lineHeight: 18 },
  secondaryFlowBtn: { alignItems: 'center', paddingVertical: 13, marginTop: 10, borderRadius: 7, borderWidth: 1, borderColor: COLORS.cardBorder },
  secondaryFlowText: { color: COLORS.cyan, fontSize: 12, fontWeight: '800' },
  topHeader: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: COLORS.cardBorder },
  backBtnText: { color: COLORS.cyan, fontSize: 16, fontWeight: '700' },
  detailsContent: { paddingHorizontal: 18, paddingBottom: 104 },

  brandHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 4,
  },
  brandTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textLight, letterSpacing: 1.1 },
  authLogo: { alignSelf: 'center', color: COLORS.cyan, fontSize: 21, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },
  headerRightIcons: { flexDirection: 'row', gap: 8 },
  iconTxt: { color: COLORS.textLight, fontSize: 20, paddingHorizontal: 7, paddingVertical: 5 },

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
  chipTextActive: { color: '#ffffff', fontWeight: '800' },

  heroCard: { marginHorizontal: 18, marginTop: 8, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.cardBorder },
  heroPosterImage: {
    width: '100%',
    height: 150,
    backgroundColor: COLORS.cardBg,
    borderBottomWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  heroGradient: {
    backgroundColor: COLORS.cardBg,
    padding: 14,
  },
  heroPosterPlaceholder: {
    backgroundColor: COLORS.cardBg,
    padding: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  posterPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
  },
  episodeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  vipTitleLabel: {
    backgroundColor: COLORS.gold,
    color: '#17130b',
    fontSize: 10,
    fontWeight: '900',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  heroDramaTitle: { color: COLORS.textLight, fontSize: 18, fontWeight: '800' },
  heroSub: { color: COLORS.textMuted, fontSize: 13, marginTop: 4 },
  heroBtnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cyanActionBtn: {
    backgroundColor: COLORS.cyan,
    minHeight: 46,
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 9,
  },
  cyanActionBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 13 },
  listActionBtn: {
    backgroundColor: COLORS.cardBg,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  listActionBtnText: { color: COLORS.textLight, fontWeight: '700', fontSize: 13 },

  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingRight: 16,
    marginTop: 16,
  },
  sectionHeaderTitle: { color: COLORS.textLight, fontSize: 18, fontWeight: '700', marginLeft: 18, marginTop: 16 },
  seeAllText: { color: COLORS.cyan, fontSize: 13, fontWeight: '600' },

  railList: { paddingHorizontal: 18, paddingVertical: 10, gap: 10 },
  continueCard: {
    width: 148,
    backgroundColor: COLORS.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    overflow: 'hidden',
  },
  continuePosterPlaceholder: {
    height: 84,
    backgroundColor: '#edf2ef',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 6,
  },
  placeholderLabel: { color: COLORS.textMuted, fontSize: 11, textAlign: 'center', fontWeight: '600' },
  progressTrackSmall: { height: 3, backgroundColor: COLORS.cardBorder, width: '100%' },
  progressBarSmall: { height: '100%', backgroundColor: COLORS.cyan },
  cardFooterRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 8 },
  metaSmallText: { color: COLORS.textDim, fontSize: 10, fontWeight: '700' },

  popularCard: { width: 132, minHeight: 190, borderRadius: 12, overflow: 'hidden' },
  popularPosterFrame: { width: 132, height: 154, borderRadius: 12, overflow: 'hidden', position: 'relative', backgroundColor: COLORS.cardBg },
  popularPosterPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.cardBg,
    borderRadius: 12,
  },
  popularCardTitle: { color: COLORS.textLight, fontSize: 14, fontWeight: '700', lineHeight: 18, marginTop: 7 },

  // Drama Details View
  dramaDescription: { color: COLORS.textMuted, fontSize: 15, marginTop: 16, lineHeight: 23 },
  descriptionToggle: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginTop: 2, paddingRight: 12 },
  descriptionToggleText: { color: COLORS.cyan, fontSize: 15, fontWeight: '700' },
  cyanPrimaryBtn: {
    backgroundColor: COLORS.cyan,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 14,
  },
  cyanPrimaryBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
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
  episodeTitle: { color: COLORS.textLight, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  episodeMeta: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  cyanSmallBtn: {
    backgroundColor: COLORS.cyan,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  cyanSmallBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 12 },

  // Video Player Styles
  playerContainer: { flex: 1, backgroundColor: COLORS.bg },
  playerFullscreen: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 1000 },
  playerTopBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 16 },
  playerScreenTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginLeft: 14, flex: 1 },
  videoStage: {
    height: 320,
    backgroundColor: COLORS.bg,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  videoStageFullscreen: { height: undefined, flex: 1, width: '100%', alignSelf: 'stretch' },
  watermarkContainer: { position: 'absolute', top: 12, right: 12, zIndex: 99, backgroundColor: 'rgba(17,22,29,0.82)', borderRadius: 6, paddingHorizontal: 9, paddingVertical: 6 },
  watermarkText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.9 },
  emptyCatalog: { color: COLORS.textDim, fontSize: 13, textAlign: 'center', padding: 24 },
  adLoading: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  adLoadingText: { color: '#fff', fontSize: 12, marginTop: 10 },
  adErrorBackdrop: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg },
  adErrorText: { color: COLORS.textMuted, fontSize: 12, marginTop: 8 },
  adCard: {
    width: '90%',
    backgroundColor: COLORS.cardBg,
    borderWidth: 1,
    borderColor: COLORS.gold,
    borderRadius: 16,
    padding: 14,
  },
  adOverlayCard: { backgroundColor: 'rgba(27,34,47,0.94)' },
  adPlayerOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'space-between', padding: 10 },
  adBrandOverlay: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', maxWidth: '90%', padding: 8, borderRadius: 10, backgroundColor: 'rgba(17,22,29,0.78)' },
  adBrandMark: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.cyan },
  adBrandInitial: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  adBrandCopy: { flex: 1, marginLeft: 9 },
  adBrandLabel: { color: '#e1e5eb', fontSize: 11, marginTop: 2 },
  adTitle: { color: '#fff', fontSize: 14, fontWeight: '800' },
  adControlsOverlay: { padding: 10, borderRadius: 10, backgroundColor: 'rgba(17,22,29,0.84)' },
  adProgressTrack: { height: 3, overflow: 'hidden', borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.4)' },
  adProgressFill: { height: '100%', backgroundColor: COLORS.cyan },
  adControlsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 9, gap: 8 },
  adPlaybackControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  adPlayButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  adPlayButtonText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  adFullscreenButtonText: { color: '#fff', fontSize: 24, fontWeight: '700' },
  adTimeText: { color: '#fff', fontSize: 10, fontWeight: '600' },
  adActionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  adVisitButton: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 7, backgroundColor: COLORS.cyan },
  adVisitButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  learnMoreText: { color: COLORS.cyan, fontSize: 12, fontWeight: '700' },
  adSkipButton: { minHeight: 38, paddingHorizontal: 10, borderRadius: 7 },
  adDestination: { color: '#d5d9df', fontSize: 10, marginTop: 5, marginLeft: 44 },
  skipBtn: { backgroundColor: COLORS.cardBorder, minHeight: 48, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 10 },
  skipBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  activeStreamBanner: { alignItems: 'center' },
  playerControlsArea: { padding: 16 },
  progressTrack: { height: 4, backgroundColor: COLORS.cardBorder, borderRadius: 2 },
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
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.cyan,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playPauseIcon: { color: '#ffffff', fontSize: 18, fontWeight: '900' },

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
  searchInput: { flex: 1, height: 44, color: COLORS.textLight, paddingHorizontal: 10 },
  filterIcon: { color: COLORS.textMuted, fontSize: 16 },
  searchFilterPanel: { marginTop: 14, padding: 13, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 14, backgroundColor: COLORS.cardBg },
  searchFilterHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 5 },
  searchFilterOptions: { paddingTop: 2 },
  searchFilterToggle: { flex: 1, minHeight: 36, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginRight: 8 },
  searchFilterHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchFilterToggleText: { color: COLORS.cyan, fontSize: 12, fontWeight: '700', paddingHorizontal: 8 },
  searchFilterTitle: { color: COLORS.textLight, fontSize: 15, fontWeight: '800' },
  searchFilterCount: { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: COLORS.cyanSoft, alignItems: 'center', justifyContent: 'center' },
  searchFilterCountText: { color: COLORS.cyan, fontSize: 11, fontWeight: '800' },
  searchFilterReset: { color: COLORS.cyan, fontSize: 12, fontWeight: '700', paddingHorizontal: 7, paddingVertical: 5 },
  searchFilterLabel: { color: COLORS.textDim, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginTop: 11 },
  searchFilterRow: { paddingTop: 7, paddingBottom: 2, gap: 7 },
  searchFilterChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder },
  searchFilterChipActive: { backgroundColor: COLORS.cyanSoft, borderColor: COLORS.cyan },
  searchFilterChipText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  searchFilterChipTextActive: { color: COLORS.cyan, fontWeight: '800' },
  searchFilterInline: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 },
  searchFilterInlineChip: { paddingHorizontal: 9, paddingVertical: 7 },
  searchResultsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 19, marginBottom: 2 },
  resultsCount: { color: COLORS.textDim, fontSize: 12, fontWeight: '600' },
  errorBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.dangerSoft,
    borderColor: '#9f1239',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    margin: 16,
  },
  errorText: { color: COLORS.danger, flex: 1, fontSize: 12, marginRight: 10 },
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
    backgroundColor: COLORS.cardBg,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchThumbLabel: { color: COLORS.textDim, fontSize: 10, fontWeight: '800' },
  searchResultTitle: { color: COLORS.textLight, fontSize: 13, fontWeight: '800', flexShrink: 1 },
  searchResultMeta: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },

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
  creatorPoster: { width: 58, height: 78, borderRadius: 5, backgroundColor: '#edf2ef' },
  creatorContentInfo: { flex: 1, minWidth: 0 },
  creatorMeta: { color: COLORS.cyan, fontSize: 9, marginTop: 4 },
  creatorStatusApproved: { color: COLORS.green, fontSize: 9, fontWeight: '800', marginTop: 5 },
  creatorStatusRejected: { color: COLORS.danger, fontSize: 9, fontWeight: '800', marginTop: 5 },
  creatorStatusPending: { color: COLORS.gold, fontSize: 9, fontWeight: '800', marginTop: 5 },
  creatorDetailsAction: { color: COLORS.cyan, fontSize: 10, fontWeight: '800', padding: 6 },
  creatorManageButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: COLORS.cyan, borderRadius: 8, backgroundColor: COLORS.cyanSoft },
  creatorManageButtonText: { color: COLORS.cyan, fontSize: 11, fontWeight: '800' },
  creatorStatsRow: { flexDirection: 'row', borderTopWidth: 1, borderColor: COLORS.cardBorder, marginTop: 12, paddingTop: 10 },
  creatorStatCell: { flex: 1 },
  creatorStatValue: { color: COLORS.textLight, fontSize: 12, fontWeight: '800', marginTop: 4 },
  creatorDetails: { borderTopWidth: 1, borderColor: COLORS.cardBorder, marginTop: 12, paddingTop: 12 },
  creatorContentActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8, borderTopWidth: 1, borderColor: COLORS.cardBorder, marginTop: 10, paddingTop: 9 },
  creatorDeleteAction: { color: COLORS.danger, fontSize: 10, fontWeight: '800', padding: 6 },
  creatorDetailsHeading: { color: COLORS.textLight, fontSize: 11, fontWeight: '800', marginTop: 7, marginBottom: 5 },
  creatorDetailText: { color: COLORS.textDim, fontSize: 10, lineHeight: 16 },
  creatorEpisodeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 7, borderTopWidth: 1, borderColor: COLORS.cardBorder },
  creatorPayoutCard: { backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 8, padding: 14, marginTop: 18 },
  creatorPayoutAvailable: { color: COLORS.green, fontSize: 16, fontWeight: '900' },
  creatorPayoutForm: { flexDirection: 'row', gap: 8, marginTop: 8 },
  creatorPayoutInput: { flex: 1, minHeight: 40, backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 7, color: COLORS.textLight, paddingHorizontal: 10, fontSize: 11 },
  creatorPayoutRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderColor: COLORS.cardBorder },
  creatorHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  screenMainTitle: { color: COLORS.textLight, fontSize: 20, fontWeight: '900' },
  screenSubTitle: { color: COLORS.textDim, fontSize: 12, marginTop: 2 },
  uploadBtn: { backgroundColor: COLORS.cyan, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  uploadBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 12 },
  metricCard: {
    backgroundColor: COLORS.cardBg,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 16,
  },
  metricCardLabel: { color: COLORS.textLight, fontSize: 14, fontWeight: '800' },
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
  pipelineTitle: { color: COLORS.textLight, fontSize: 13, fontWeight: '700' },
  pipelineSub: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  badgeWarning: { backgroundColor: '#fff3d9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  badgeWarningText: { color: COLORS.gold, fontSize: 10, fontWeight: '800' },
  badgeSuccess: { backgroundColor: COLORS.greenSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
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
  campaignTitle: { color: COLORS.textLight, fontSize: 14, fontWeight: '800' },
  campaignSub: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  advertiserPage: { padding: 16, paddingBottom: 96 },
  advertiserHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  advertiserHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  advertiserRefresh: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 11, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 7 },
  advertiserSummaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  advertiserSummaryCard: { flexBasis: '47%', flexGrow: 1, minWidth: 128, minHeight: 76, backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 8, padding: 11 },
  advertiserSummaryLabel: { color: COLORS.textDim, fontSize: 9, fontWeight: '700' },
  advertiserSummaryValue: { color: COLORS.textLight, fontSize: 16, fontWeight: '900', marginTop: 7 },
  advertiserEmpty: { alignItems: 'center', backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 8, padding: 24, marginTop: 8 },
  advertiserCampaignCard: { backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 8, padding: 14, marginTop: 10 },
  advertiserCampaignHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  advertiserStatusActive: { color: COLORS.green, backgroundColor: COLORS.greenSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, fontSize: 9, fontWeight: '800' },
  advertiserStatusPaused: { color: COLORS.gold, backgroundColor: '#fff3d9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, fontSize: 9, fontWeight: '800' },
  advertiserBudgetHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  advertiserBudgetMain: { color: COLORS.textLight, fontSize: 19, fontWeight: '900' },
  advertiserBudgetMinor: { color: COLORS.textDim, fontSize: 10, fontWeight: '500' },
  advertiserBudgetTotal: { color: COLORS.textDim, fontSize: 10 },
  advertiserBudgetTrack: { height: 6, backgroundColor: '#e9efeb', borderRadius: 4, overflow: 'hidden', marginTop: 10 },
  advertiserBudgetFill: { height: '100%', backgroundColor: COLORS.cyan, borderRadius: 4 },
  advertiserCampaignStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, borderTopWidth: 1, borderColor: COLORS.cardBorder, marginTop: 12, paddingTop: 12 },
  advertiserCampaignStatValue: { color: COLORS.textLight, fontSize: 11, fontWeight: '800', marginTop: 4 },
  creativePicker: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 62, padding: 11, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 8, backgroundColor: COLORS.cardBg },
  creativePickerIcon: { color: COLORS.cyan, fontSize: 18, fontWeight: '900' },
  creativePickerTitle: { color: COLORS.textLight, fontSize: 11, fontWeight: '800' },
  creativePickerSub: { color: COLORS.textDim, fontSize: 9, marginTop: 4 },
  creativePickerAction: { color: COLORS.cyan, fontSize: 10, fontWeight: '800' },
  campaignChoiceSection: { marginTop: 16 },
  campaignChoiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 7 },
  campaignChoice: { minHeight: 37, justifyContent: 'center', paddingHorizontal: 12, backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 7 },
  campaignChoiceActive: { borderColor: COLORS.cyan, backgroundColor: COLORS.cyanSoft },
  campaignChoiceLabel: { color: COLORS.textDim, fontSize: 10, fontWeight: '700' },
  campaignChoiceLabelActive: { color: COLORS.cyan },
  campaignBudgetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  campaignBudgetAmount: { color: COLORS.textLight, fontSize: 15, fontWeight: '900' },
  budgetStepper: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  campaignPickerHint: { color: COLORS.textDim, fontSize: 9 },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  stepperButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 7 },
  stepperButtonText: { color: COLORS.cyan, fontSize: 20, fontWeight: '700' },
  stepperValue: { minWidth: 70, textAlign: 'center', color: COLORS.textLight, fontSize: 11, fontWeight: '800' },
  reachEstimate: { alignItems: 'center', backgroundColor: COLORS.cyanSoft, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 8, padding: 16, marginTop: 18 },
  reachEstimateLabel: { color: COLORS.textDim, fontSize: 10, fontWeight: '700' },
  reachEstimateValue: { color: COLORS.cyan, fontSize: 28, fontWeight: '900', marginTop: 5 },
  reachEstimateFootnote: { color: COLORS.textDim, fontSize: 9, marginTop: 5, textAlign: 'center' },
  paramGrid: { backgroundColor: COLORS.cardBg, padding: 10, borderRadius: 8, marginTop: 12 },
  paramRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 2 },
  paramLabel: { color: COLORS.textDim, fontSize: 11 },
  paramValue: { color: COLORS.textLight, fontSize: 11, fontWeight: '600' },
  statColumnsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  statBox: {
    flex: 1,
    backgroundColor: COLORS.cardBg,
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  statValue: { color: COLORS.cyan, fontSize: 16, fontWeight: '900' },
  statKey: { color: COLORS.textDim, fontSize: 10, marginTop: 2 },

  // Profile View Styles
  profilePage: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 112 },
  profilePageHeader: { marginBottom: 18 },
  profilePageTitle: { color: COLORS.textLight, fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  profilePageSubtitle: { color: COLORS.textDim, fontSize: 13, marginTop: 3 },
  profileHero: { backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 18, padding: 17 },
  profileUserRow: { flexDirection: 'row', alignItems: 'center' },
  avatarCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.cyanSoft,
    borderWidth: 1,
    borderColor: COLORS.cyan,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { color: COLORS.cyan, fontSize: 23, fontWeight: '900' },
  profileIdentity: { flex: 1, minWidth: 0, marginLeft: 14 },
  profileNameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  profileName: { flexShrink: 1, color: COLORS.textLight, fontSize: 19, fontWeight: '900' },
  profileAccountStatus: { flexDirection: 'row', flexShrink: 0, alignItems: 'center', gap: 5, backgroundColor: COLORS.greenSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  profileAccountStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.green },
  profileAccountStatusText: { color: COLORS.green, fontSize: 9, fontWeight: '800' },
  profileEmail: { color: COLORS.textDim, fontSize: 12, marginTop: 4 },
  profileHeroDivider: { height: 1, backgroundColor: COLORS.cardBorder, marginTop: 17, marginBottom: 14 },
  profileStatusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  profileMetaColumn: { flex: 1, minWidth: 0 },
  profileMetaLabel: { color: COLORS.textDim, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  profileMetaValue: { color: COLORS.textLight, fontSize: 14, fontWeight: '700', marginTop: 4 },
  profileVipValue: { color: COLORS.gold },
  profileSection: { marginTop: 25 },
  profileSectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 },
  profileSectionTitle: { color: COLORS.textLight, fontSize: 17, fontWeight: '800', letterSpacing: 0.1 },
  profileActiveLabel: { color: COLORS.green, fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  profileRoleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  profileRoleCard: { flex: 1, minWidth: 145, minHeight: 96, backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 15, padding: 13, justifyContent: 'space-between' },
  profileRoleIcon: { color: COLORS.cyan, fontSize: 19, fontWeight: '900' },
  profileRoleTitle: { color: COLORS.textLight, fontSize: 13, fontWeight: '800' },
  profileRoleArrow: { color: COLORS.textDim, fontSize: 24, lineHeight: 26 },
  profilePlanGrid: { flexDirection: 'row', gap: 10 },
  profilePlanCard: { flex: 1, minHeight: 80, backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, justifyContent: 'center' },
  profilePlanName: { color: COLORS.textDim, fontSize: 12, fontWeight: '700' },
  profilePlanPrice: { color: COLORS.textLight, fontSize: 16, fontWeight: '900', marginTop: 5 },
  profileRefreshButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 10, borderRadius: 12, backgroundColor: COLORS.cyanSoft },
  profileRefreshText: { color: COLORS.cyan, fontSize: 12, fontWeight: '800' },
  profileNotice: { color: COLORS.cyan, fontSize: 12, lineHeight: 18, marginTop: 14 },
  profileActions: { marginTop: 25, borderTopWidth: 1, borderColor: COLORS.cardBorder },
  profileActionRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: COLORS.cardBorder, paddingHorizontal: 2 },
  profileActionTitle: { color: COLORS.textLight, fontSize: 14, fontWeight: '700' },
  engagementActionSub: { color: COLORS.textDim, fontSize: 11, marginTop: 3 },
  profileSignOutRow: { marginTop: 1 },
  profileSignOutText: { color: COLORS.danger, fontSize: 14, fontWeight: '700' },
  engagementPage: { padding: 18, paddingBottom: 40 },
  engagementTabs: { flexDirection: 'row', gap: 7, marginTop: 18, marginBottom: 14 },
  engagementTab: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 9 },
  engagementTabActive: { borderColor: COLORS.cyan, backgroundColor: COLORS.cyanSoft },
  engagementTabText: { color: COLORS.textDim, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  engagementTabTextActive: { color: COLORS.cyan },
  engagementError: { color: COLORS.danger, backgroundColor: COLORS.dangerSoft, borderRadius: 8, padding: 11, marginBottom: 12, fontSize: 12 },
  engagementNotice: { color: COLORS.green, backgroundColor: COLORS.greenSoft, borderRadius: 8, padding: 11, marginBottom: 12, fontSize: 12 },
  engagementLoading: { alignItems: 'center', gap: 12, paddingVertical: 30 },
  engagementSectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 11 },
  engagementEmpty: { alignItems: 'center', backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 11, padding: 20, marginTop: 7 },
  engagementEmptyTitle: { color: COLORS.textLight, fontSize: 14, fontWeight: '800', marginBottom: 5 },
  engagementEmptyText: { color: COLORS.textDim, fontSize: 12, lineHeight: 18, paddingVertical: 10 },
  notificationCard: { backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 10, padding: 13, marginTop: 9 },
  notificationCardUnread: { borderColor: COLORS.cyanDark },
  notificationHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  notificationTitle: { color: COLORS.textLight, fontSize: 13, fontWeight: '800', flexShrink: 1 },
  notificationUnreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.cyan },
  notificationBody: { color: COLORS.textMuted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  notificationDate: { color: COLORS.textDim, fontSize: 10, marginTop: 8 },
  referralInviteCard: { backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 14, padding: 16, marginTop: 4 },
  referralInviteEyebrow: { color: COLORS.textDim, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  referralInviteCode: { color: COLORS.cyan, fontSize: 24, fontWeight: '900', letterSpacing: 1.5, marginTop: 8, marginBottom: 8 },
  referralStatsRow: { flexDirection: 'row', gap: 9, marginTop: 12 },
  referralStatCard: { flex: 1, alignItems: 'center', backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 10, padding: 13 },
  engagementStatValue: { color: COLORS.cyan, fontSize: 18, fontWeight: '900' },
  engagementStatLabel: { color: COLORS.textDim, fontSize: 10, textAlign: 'center', marginTop: 4 },
  engagementRewardsHeading: { marginTop: 21, marginBottom: 4 },
  referralActivityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.cardBg, borderRadius: 8, padding: 12, marginTop: 7 },
  rewardStatus: { color: COLORS.gold, fontSize: 10, fontWeight: '800' },
  engagementFootnote: { color: COLORS.textDim, fontSize: 10, lineHeight: 15, marginTop: 13 },
  preferenceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9, marginTop: 9 },
  preferenceCopy: { flex: 1 },
  preferenceDescription: { color: COLORS.textDim, fontSize: 10, lineHeight: 15, marginTop: 3 },
  engagementRefresh: { alignItems: 'center', justifyContent: 'center', minHeight: 44, backgroundColor: COLORS.cyanSoft, borderRadius: 10, marginTop: 17 },
  vipHeaderCentered: { color: COLORS.textLight, fontSize: 18, fontWeight: '900', textAlign: 'center', marginTop: 10 },
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
  planTitle: { color: COLORS.textLight, fontSize: 14, fontWeight: '800' },
  planBadgeText: { color: COLORS.gold, fontSize: 11, fontWeight: '700', marginTop: 2 },
  planPrice: { color: COLORS.textLight, fontSize: 14, fontWeight: '900' },
  planSub: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  referralCard: {
    backgroundColor: COLORS.cardBg,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 16,
  },
  referralTitle: { color: COLORS.textLight, fontSize: 13, fontWeight: '800' },
  referralCode: { color: COLORS.textDim, fontSize: 12, marginTop: 4 },
  whatsappBtn: {
    backgroundColor: COLORS.greenBtn,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 10,
  },
  whatsappBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 13 },
  supportCard: {
    backgroundColor: COLORS.cardBg,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 12,
  },
  supportHeader: { color: COLORS.textLight, fontSize: 13, fontWeight: '800' },
  supportSub: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  contactSupportLink: { color: COLORS.cyan, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },

  // Bottom Navigation Bar
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 76,
    backgroundColor: COLORS.cardBg,
    borderTopWidth: 1,
    borderColor: COLORS.cardBorder,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  navItem: { alignItems: 'center', justifyContent: 'center', minWidth: 56, minHeight: 56, paddingHorizontal: 4 },
  navIcon: { color: COLORS.textDim, fontSize: 20 },
  navLabel: { color: COLORS.textDim, fontSize: 12, fontWeight: '600', marginTop: 3 },
});
