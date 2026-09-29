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
} from 'react-native';
import { DramaItem } from './src/data/models/Drama';
import { COLORS } from './src/theme/colors';
import { ProtectedVideoPlayer } from './src/components/ProtectedVideoPlayer';
import { AdPayload, createAdvertiserCampaign, createCreatorUpload, createSupportTicket, createVipCheckout, getAdPayload, getCatalog, getCurrentSubscription, getViewerProfile, listAdvertiserCampaigns, listCreatorSubmissions, listSupportTickets, loginViewer, registerViewer, searchCatalog, submitCreatorContent, ViewerProfile } from './src/api/client';
import { clearSession, readSession } from './src/core/security/sessionStorage';

export default function App() {
  const [activeTab, setActiveTab] = useState<'Home' | 'Search' | 'Creator' | 'Ads' | 'Profile'>('Home');
  const [currentScreen, setCurrentScreen] = useState<'Tabs' | 'Details' | 'Player' | 'Payout' | 'Upload' | 'Campaign' | 'Checkout' | 'Support'>('Tabs');
  const [catalog, setCatalog] = useState<DramaItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedDrama, setSelectedDrama] = useState<DramaItem | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState('');
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
    getCatalog()
      .then(setCatalog)
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
    ...(profile.role === 'CREATOR' ? [{ key: 'Creator', icon: '🎬', label: 'Creator' }] : []),
    ...(profile.role === 'ADVERTISER' ? [{ key: 'Ads', icon: '📊', label: 'Ads' }] : []),
    { key: 'Profile', icon: '👤', label: 'Profile' },
  ];

  const openDramaDetails = (drama: DramaItem) => {
    setSelectedDrama(drama);
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
              <View style={styles.heroPosterPlaceholder}>
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
          {activeTab === 'Home' && <HomeTabView dramas={catalog} loading={catalogLoading} error={catalogError} onRetry={loadCatalog} onSelect={openDramaDetails} onPlay={startPlayback} onSearch={() => setActiveTab('Search')} onProfile={() => setActiveTab('Profile')} />}
          {activeTab === 'Search' && <SearchTabView dramas={catalog} loading={catalogLoading} onSelect={openDramaDetails} />}
          {activeTab === 'Creator' && <CreatorTabView creatorName={profile.name} onUpload={() => setCurrentScreen('Upload')} />}
          {activeTab === 'Ads' && <AdsTabView onCampaign={() => setCurrentScreen('Campaign')} />}
          {activeTab === 'Profile' && <ProfileTabView profile={profile} onSupport={() => setCurrentScreen('Support')} onRefreshProfile={async () => { const updated = await getViewerProfile(); setProfile(updated); }} onSignOut={async () => { await clearSession(); setProfile(null); setCurrentScreen('Tabs'); setActiveTab('Home'); }} />}
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const profile = registering
        ? await registerViewer(name, email, password)
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
        {!!error && <Text style={{ color: '#fca5a5', marginTop: 14 }}>{error}</Text>}
        <TouchableOpacity style={[styles.cyanPrimaryBtn, { marginTop: 20 }]} disabled={busy} onPress={submit}>
          <Text style={styles.cyanPrimaryBtnText}>{busy ? 'Connecting...' : registering ? 'Create account' : 'Sign in'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ alignItems: 'center', padding: 16 }} onPress={() => { setRegistering(!registering); setError(''); }}>
          <Text style={{ color: COLORS.cyan }}>{registering ? 'Already have an account? Sign in' : 'New to Global Station? Create account'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// --- TAB 1: HOME ---
function HomeTabView({ dramas, loading, error, onRetry, onSelect, onPlay, onSearch, onProfile }: { dramas: DramaItem[]; loading: boolean; error: string | null; onRetry: () => void; onSelect: (d: DramaItem) => void; onPlay: (d: DramaItem) => void; onSearch: () => void; onProfile: () => void }) {
  const [filter, setFilter] = useState('All');
  const visibleDramas = filter === 'All' ? dramas : filter === '⭐ VIP' ? dramas.filter((d) => d.badge === 'VIP') : dramas.filter((d) => d.category === filter);
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
      <Text style={styles.sectionHeaderTitle}>Continue Watching</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railList}>
        {visibleDramas.filter((d) => d.progress).map((d) => (
          <TouchableOpacity key={d.id} style={styles.continueCard} onPress={() => onSelect(d)}>
            <View style={styles.continuePosterPlaceholder}>
              <Text style={styles.placeholderLabel}>{d.title}</Text>
            </View>
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

      {/* Popular Dramas Rail */}
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionHeaderTitle}>Popular Dramas</Text>
        <TouchableOpacity onPress={() => setFilter('All')}><Text style={styles.seeAllText}>See all ›</Text></TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railList}>
        {visibleDramas.filter((d) => !d.progress).map((d) => (
          <TouchableOpacity key={d.id} style={styles.popularCard} onPress={() => onSelect(d)}>
            <View style={styles.popularPosterPlaceholder}>
              <View style={d.badge === 'VIP' ? styles.badgeVip : styles.badgeFree}>
                <Text style={styles.badgeText}>{d.badge}</Text>
              </View>
              <Text numberOfLines={2} style={styles.popularCardTitle}>{d.title}</Text>
            </View>
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

  const filtered = results.filter((d) =>
    (selectedPill === 'All' ||
      (selectedPill === 'VIP Only' ? d.badge === 'VIP' : d.category.includes(selectedPill)))
  );

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
          <View style={styles.searchThumbPlaceholder}>
            <Text style={styles.searchThumbLabel}>{d.badge}</Text>
          </View>
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
  const [submissions, setSubmissions] = useState<Awaited<ReturnType<typeof listCreatorSubmissions>>>([]);
  const [error, setError] = useState('');
  useEffect(() => { listCreatorSubmissions().then(setSubmissions).catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Unable to load submissions.')); }, []);

  return <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }}>
    <View style={styles.creatorHeaderRow}><View><Text style={styles.screenMainTitle}>Creator Studio</Text><Text style={styles.screenSubTitle}>{creatorName}</Text></View><TouchableOpacity style={styles.uploadBtn} onPress={onUpload}><Text style={styles.uploadBtnText}>+ Upload video</Text></TouchableOpacity></View>
    <Text style={styles.screenSubTitle}>Creator revenue and payouts will appear when those backend workflows are configured.</Text>
    <Text style={[styles.sectionHeaderTitle, { marginTop: 24 }]}>Your submissions</Text>
    {submissions.map((submission) => <View key={submission.id} style={styles.pipelineCard}><View style={{ flex: 1 }}><Text style={styles.pipelineTitle}>{submission.title}</Text><Text style={styles.pipelineSub}>{submission.episodeCount} episode(s) • {new Date(submission.createdAt).toLocaleDateString()}</Text></View><Text style={styles.badgeWarningText}>{submission.status.replace('_', ' ')}</Text></View>)}
    {!error && submissions.length === 0 && <Text style={styles.screenSubTitle}>No content submissions yet.</Text>}
    {!!error && <Text style={styles.errorText}>{error}</Text>}
  </ScrollView>;
}

// --- TAB 4: ADVERTISER HUB ---
function AdsTabView({ onCampaign }: { onCampaign: () => void }) {
  const [campaigns, setCampaigns] = useState<Awaited<ReturnType<typeof listAdvertiserCampaigns>>>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    listAdvertiserCampaigns().then(setCampaigns).catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Unable to load campaigns.'));
  }, []);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }}>
      <View style={styles.creatorHeaderRow}>
        <View>
          <Text style={styles.screenMainTitle}>Advertiser Hub</Text>
          <Text style={styles.screenSubTitle}>Campaigns from your account</Text>
        </View>
        <TouchableOpacity style={styles.uploadBtn} onPress={onCampaign}>
          <Text style={styles.uploadBtnText}>+ New Campaign</Text>
        </TouchableOpacity>
      </View>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
      {campaigns.map((campaign) => <View key={campaign.id} style={styles.campaignCard}>
        <View style={styles.campaignHeaderRow}><Text style={styles.campaignTitle}>{campaign.campaignName}</Text><Text style={styles.badgeWarningText}>{campaign.status}</Text></View>
        <Text style={styles.campaignSub}>Audience: {campaign.targetTier}</Text>
        <View style={styles.paramGrid}>
          <View style={styles.paramRow}><Text style={styles.paramLabel}>Remaining budget</Text><Text style={styles.paramValue}>RM {Number(campaign.remainingBudget).toFixed(2)}</Text></View>
          <View style={styles.paramRow}><Text style={styles.paramLabel}>CPM</Text><Text style={styles.paramValue}>RM {Number(campaign.cpmRate).toFixed(2)}</Text></View>
          <View style={styles.paramRow}><Text style={styles.paramLabel}>Served impressions</Text><Text style={styles.paramValue}>{campaign.impressions}</Text></View>
        </View>
      </View>)}
      {!error && campaigns.length === 0 && <Text style={styles.screenSubTitle}>No campaigns have been submitted from this account.</Text>}
    </ScrollView>
  );
}

// --- TAB 5: PROFILE & VIP SUBSCRIPTION ---
function ProfileTabView({ profile, onSupport, onRefreshProfile, onSignOut }: { profile: ViewerProfile; onSupport: () => void; onRefreshProfile: () => Promise<void>; onSignOut: () => void }) {
  const [subscription, setSubscription] = useState<Awaited<ReturnType<typeof getCurrentSubscription>>>(null);
  const [message, setMessage] = useState('');
  const [busyPlan, setBusyPlan] = useState<'VIP_MONTHLY' | 'VIP_YEARLY' | null>(null);

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

function UploadScreen({ onBack }: { onBack: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [genre, setGenre] = useState('');
  const [category, setCategory] = useState('');
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [durationSeconds, setDurationSeconds] = useState('');
  const [contentType, setContentType] = useState<'MOVIE' | 'SERIES'>('SERIES');
  const [isExclusiveVip, setIsExclusiveVip] = useState(false);
  const [video, setVideo] = useState<{ path: string; name: string; size: number } | null>(null);
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
    if (!video) { setNotice('Select an MP4 video first.'); return; }
    if (!title.trim() || !description.trim() || !posterUrl.trim() || !genre.trim() || !category.trim() || !episodeTitle.trim() || Number(durationSeconds) <= 0) {
      setNotice('Complete all content details before submitting.');
      return;
    }
    setBusy(true);
    setNotice('');
    setProgress(0);
    try {
      const upload = await createCreatorUpload(video.size);
      const result = await ReactNativeBlobUtil.fetch('PUT', upload.uploadUrl, { 'Content-Type': upload.contentType }, ReactNativeBlobUtil.wrap(video.path))
        .uploadProgress({ interval: 500 }, (written, total) => setProgress(Math.min(100, Math.round(written / Math.max(1, total) * 100))));
      if (result.info().status < 200 || result.info().status >= 300) throw new Error(`Video upload failed (${result.info().status}).`);
      await submitCreatorContent({ title, contentType, description, posterUrl, rating: 'P13', genre, category, episodeTitle, durationSeconds: Number(durationSeconds), mediaKey: upload.objectKey, isExclusiveVip });
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
    <Text style={styles.screenSubTitle}>MP4 is stored privately in S3. Admin approval is required before viewers can access it.</Text>
    <TouchableOpacity style={styles.secondaryFlowBtn} disabled={busy} onPress={chooseVideo}><Text style={styles.secondaryFlowText}>{video ? `${video.name} • ${(video.size / 1048576).toFixed(1)} MB` : 'Choose MP4 video'}</Text></TouchableOpacity>
    <View style={styles.heroBtnRow}>{(['SERIES', 'MOVIE'] as const).map((type) => <TouchableOpacity key={type} style={[styles.chip, contentType === type && styles.chipActive]} onPress={() => setContentType(type)}><Text style={[styles.chipText, contentType === type && styles.chipTextActive]}>{type}</Text></TouchableOpacity>)}</View>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Title</Text><TextInput value={title} onChangeText={setTitle} style={styles.flowInput} /></View>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Episode title</Text><TextInput value={episodeTitle} onChangeText={setEpisodeTitle} style={styles.flowInput} /></View>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Synopsis</Text><TextInput value={description} onChangeText={setDescription} style={[styles.flowInput, styles.flowTextArea]} multiline textAlignVertical="top" /></View>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Poster image URL (HTTPS)</Text><TextInput value={posterUrl} onChangeText={setPosterUrl} style={styles.flowInput} autoCapitalize="none" keyboardType="url" /></View>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Genre</Text><TextInput value={genre} onChangeText={setGenre} style={styles.flowInput} /></View>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Category</Text><TextInput value={category} onChangeText={setCategory} style={styles.flowInput} /></View>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Duration (seconds)</Text><TextInput value={durationSeconds} onChangeText={setDurationSeconds} style={styles.flowInput} keyboardType="number-pad" /></View>
    <TouchableOpacity style={styles.secondaryFlowBtn} onPress={() => setIsExclusiveVip(!isExclusiveVip)}><Text style={styles.secondaryFlowText}>{isExclusiveVip ? 'VIP exclusive: on' : 'VIP exclusive: off'}</Text></TouchableOpacity>
    {busy && <Text style={styles.screenSubTitle}>Uploading {progress}%</Text>}
    {!!notice && <Text style={[styles.screenSubTitle, { marginTop: 12 }]}>{notice}</Text>}
    <TouchableOpacity style={styles.cyanPrimaryBtn} disabled={busy} onPress={submit}><Text style={styles.cyanPrimaryBtnText}>{busy ? 'Uploading...' : 'Upload and submit for review'}</Text></TouchableOpacity>
  </ScrollView></View>;
}

function CampaignScreen({ onBack }: { onBack: () => void }) {
  const [campaignName, setCampaignName] = useState('');
  const [creativeVideoUrl, setCreativeVideoUrl] = useState('');
  const [clickThroughUrl, setClickThroughUrl] = useState('');
  const [cpmRate, setCpmRate] = useState('');
  const [totalBudget, setTotalBudget] = useState('');
  const [targetTier, setTargetTier] = useState<'ALL' | 'FREE' | 'VIP'>('ALL');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setNotice('');
    try {
      await createAdvertiserCampaign({ campaignName, creativeVideoUrl, clickThroughUrl, cpmRate: Number(cpmRate), totalBudget: Number(totalBudget), targetTier });
      Alert.alert('Campaign submitted', 'The campaign is paused until an administrator activates it.');
      onBack();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to submit campaign.');
    } finally {
      setBusy(false);
    }
  }

  return <View style={styles.flowScreen}><FlowHeader title="Create campaign" onBack={onBack} /><ScrollView contentContainerStyle={styles.flowContent}>
    <Text style={styles.screenMainTitle}>Create campaign</Text>
    <Text style={styles.screenSubTitle}>Use HTTPS media and click-through URLs. Submitted campaigns start paused.</Text>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Campaign name</Text><TextInput value={campaignName} onChangeText={setCampaignName} style={styles.flowInput} /></View>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Creative MP4 URL</Text><TextInput value={creativeVideoUrl} onChangeText={setCreativeVideoUrl} autoCapitalize="none" keyboardType="url" style={styles.flowInput} /></View>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Click-through URL</Text><TextInput value={clickThroughUrl} onChangeText={setClickThroughUrl} autoCapitalize="none" keyboardType="url" style={styles.flowInput} /></View>
    <View style={styles.flowField}><Text style={styles.flowLabel}>CPM rate (MYR)</Text><TextInput value={cpmRate} onChangeText={setCpmRate} keyboardType="decimal-pad" style={styles.flowInput} /></View>
    <View style={styles.flowField}><Text style={styles.flowLabel}>Total budget (MYR)</Text><TextInput value={totalBudget} onChangeText={setTotalBudget} keyboardType="decimal-pad" style={styles.flowInput} /></View>
    <Text style={[styles.flowLabel, { marginTop: 14 }]}>Audience</Text>
    <View style={styles.heroBtnRow}>{(['ALL', 'FREE', 'VIP'] as const).map((tier) => <TouchableOpacity key={tier} style={[styles.chip, targetTier === tier && styles.chipActive]} onPress={() => setTargetTier(tier)}><Text style={[styles.chipText, targetTier === tier && styles.chipTextActive]}>{tier}</Text></TouchableOpacity>)}</View>
    {!!notice && <Text style={[styles.screenSubTitle, { marginTop: 12 }]}>{notice}</Text>}
    <TouchableOpacity style={styles.cyanPrimaryBtn} disabled={busy} onPress={submit}><Text style={styles.cyanPrimaryBtnText}>{busy ? 'Submitting...' : 'Submit campaign'}</Text></TouchableOpacity>
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
  progressTrackSmall: { height: 3, backgroundColor: '#0f172a', width: '100%' },
  progressBarSmall: { height: '100%', backgroundColor: COLORS.cyan },
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