import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createSupabaseClient } from "@club/shared";

export const supabase = createSupabaseClient(
  {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  },
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
