import { CapabilitiesPanel } from '../features/command-center/CapabilitiesPanel';
import { ApiProvider, useQueryStore } from '../lib/query';
import type { QueryStore } from '../lib/query-store';
import { useRoute, type Route } from '../lib/router';
import { browserEventSource, useEventStream, type EventSourceFactory } from '../lib/useEventStream';
import { Shell } from './Shell';

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <CapabilitiesPanel />;
    default:
      return (
        <p className="text-dim">
          No screen at this address. <a href="#/">Go to the Command Center</a>.
        </p>
      );
  }
}

function Root({ eventSource }: { eventSource: EventSourceFactory | null }) {
  const route = useRoute();
  const stream = useEventStream(useQueryStore(), eventSource);
  return (
    <Shell route={route} stream={stream}>
      <Screen route={route} />
    </Shell>
  );
}

export function App({
  store,
  eventSource = browserEventSource,
}: {
  store: QueryStore;
  eventSource?: EventSourceFactory | null;
}) {
  return (
    <ApiProvider store={store}>
      <Root eventSource={eventSource} />
    </ApiProvider>
  );
}
