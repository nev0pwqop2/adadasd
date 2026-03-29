import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGetMe } from "@workspace/api-client-react";
import NotFound from "@/pages/not-found";

import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Admin from "@/pages/Admin";
import LeaderboardPage from "@/pages/Leaderboard";
import PlansPage from "@/pages/Plans";
import CustomCursor from "@/components/CustomCursor";
import PageTransition from "@/components/PageTransition";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 0,
      refetchOnWindowFocus: false,
    },
  },
});

function AdminRoute() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading } = useGetMe({ query: { retry: false } as any });

  if (isLoading) return null;

  if (!user?.isAdmin) {
    setLocation("/");
    return null;
  }

  return <Admin />;
}

function Router() {
  return (
    <PageTransition>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/plans" component={PlansPage} />
        <Route path="/leaderboard" component={LeaderboardPage} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/admin" component={AdminRoute} />
        <Route component={NotFound} />
      </Switch>
    </PageTransition>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <CustomCursor />
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
