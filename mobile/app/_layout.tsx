import { useFonts } from 'expo-font';
import { Tabs, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, Platform, Text } from 'react-native';
import 'react-native-reanimated';

import {
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
} from '@expo-google-fonts/instrument-serif';
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
} from '@expo-google-fonts/geist';
import {
  GeistMono_400Regular,
  GeistMono_500Medium,
} from '@expo-google-fonts/geist-mono';

// @ts-ignore
import { BusProvider } from '../src/bus/use-bus';
// @ts-ignore
import { DirectorPanel } from '../src/components/DirectorPanel';
import { COLORS, FONTS } from '../src/theme/tokens';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();
  if (Platform.OS === "web") { (window as any).expoRouter = router; }
  const [loaded, error] = useFonts({
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    GeistMono_400Regular,
    GeistMono_500Medium,
  });

  const [directorVisible, setDirectorVisible] = useState(false);

  useEffect(() => {
    if (error) {
      console.warn('Error loading fonts:', error);
    }
  }, [error]);

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === '`') {
          setDirectorVisible(v => !v);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, []);

  if (!loaded && !error) {
    return null;
  }

  return (
    <BusProvider>
      <View style={{ flex: 1, height: '100%', backgroundColor: COLORS.ink }}>
        <Tabs
          screenOptions={{ headerShown: false }}
          tabBar={(props) => (
            <View style={styles.tabBar}>
              {props.state.routes.map((route, index) => {
                const { options } = props.descriptors[route.key];
                if (['pair', 'debrief', 'patterns', 'apps', 'style-tile'].includes(route.name)) {
                  return null;
                }
                const label = options.title !== undefined ? options.title : route.name;
                const isFocused = props.state.index === index;
                const onPress = () => {
                  const event = (props as any).navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!isFocused && !event.defaultPrevented) {
                    router.navigate(`/${route.name}` as any);
                  }
                };
                return (
                  <Pressable key={route.key} onPress={onPress} style={styles.tabItem}>
                    <Text style={[styles.tabLabel, { color: isFocused ? COLORS.paper : COLORS.other }]}>
                      {label as string}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}>
          <Tabs.Screen name="index" options={{ title: 'Today' }} />
          <Tabs.Screen name="live" options={{ title: 'Live' }} />
          <Tabs.Screen name="history" options={{ title: 'History' }} />
          <Tabs.Screen name="people" options={{ title: 'People' }} />
          <Tabs.Screen name="pair" options={{ href: null }} />
          <Tabs.Screen name="debrief" options={{ href: null }} />
          <Tabs.Screen name="patterns" options={{ href: null }} />
          <Tabs.Screen name="apps" options={{ href: null }} />
        </Tabs>

        {/* Subtle top-right dev tap target */}
        <Pressable
          style={styles.devTapTarget}
          onPress={() => setDirectorVisible(true)}
          accessibilityLabel="Director Panel"
          testID="director-toggle"
        >
          <Text style={styles.devTapText}>DIR</Text>
        </Pressable>

        {directorVisible && (
          <View style={[StyleSheet.absoluteFill, { zIndex: 99999 }]}>
            <DirectorPanel
              visible={directorVisible}
              onClose={() => setDirectorVisible(false)}
            />
          </View>
        )}
      </View>
    </BusProvider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.ink,
    borderTopWidth: 1,
    borderTopColor: COLORS.hairline,
    paddingVertical: 12,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontFamily: FONTS.ui,
    fontSize: 12,
  },
  devTapTarget: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 99999,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  devTapText: {
    fontFamily: FONTS.mono,
    color: COLORS.inkMid,
    fontSize: 10,
  },
});
