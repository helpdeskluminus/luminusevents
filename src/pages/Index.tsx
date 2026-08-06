import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { CalendarDays, MapPin, Ticket, ArrowRight } from 'lucide-react';
import { formatDateTime } from '@/lib/format';

interface CompetitionRow {
  id: string;
  name: string;
  description: string | null;
  poster_url: string | null;
  venue: string | null;
  start_time: string | null;
  end_time: string | null;
  events: { name: string } | null;
}

const Index = () => {
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('competitions')
      .select('id, name, description, poster_url, venue, start_time, end_time, events(name)')
      .order('start_time', { ascending: true })
      .then(({ data }) => {
        setCompetitions((data as unknown as CompetitionRow[]) ?? []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>Techfest Competitions — Register & Get Your QR Ticket</title>
        <meta name="description" content="Browse every techfest competition, register in seconds and receive a QR entry ticket by email for the main gate and the venue." />
        <link rel="canonical" href="/" />
      </Helmet>

      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-foreground flex items-center justify-center">
              <span className="text-background text-xs font-bold">T</span>
            </div>
            <span className="font-heading font-semibold tracking-tight">Techfest</span>
          </div>
          <Link to="/auth">
            <Button variant="outline" size="sm" className="rounded-full text-xs font-semibold tracking-wider">
              STAFF LOGIN
            </Button>
          </Link>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 pt-16 pb-10">
        <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase mb-4">Entry by QR ticket</p>
        <h1 className="font-heading text-4xl sm:text-6xl font-bold tracking-tight leading-[1.05] max-w-3xl">
          Every competition. <span className="text-gradient">One ticket.</span>
        </h1>
        <p className="mt-5 text-muted-foreground max-w-xl leading-relaxed">
          Pick a competition, register with your details, and we'll email you a signed QR ticket.
          Show it at the main gate and again at the venue entrance.
        </p>
      </section>

      <main className="max-w-6xl mx-auto px-6 pb-24">
        <h2 className="font-heading text-sm font-semibold tracking-[0.2em] uppercase text-muted-foreground mb-6">
          Competitions
        </h2>

        {loading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-80 rounded-2xl border border-border bg-card animate-pulse" />
            ))}
          </div>
        ) : competitions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-16 text-center">
            <Ticket className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No competitions have been published yet. Check back soon.</p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {competitions.map((c) => (
              <article key={c.id} className="group rounded-2xl border border-border bg-card overflow-hidden flex flex-col hover:border-foreground transition-colors">
                <div className="aspect-[16/10] bg-muted overflow-hidden">
                  {c.poster_url ? (
                    <img
                      src={c.poster_url}
                      alt={`${c.name} competition poster`}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Ticket className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="p-5 flex flex-col flex-1">
                  {c.events?.name && (
                    <p className="text-[10px] font-semibold tracking-[0.18em] uppercase text-primary mb-1.5">{c.events.name}</p>
                  )}
                  <h3 className="font-heading text-lg font-semibold leading-tight">{c.name}</h3>
                  {c.description && (
                    <p className="mt-2 text-sm text-muted-foreground line-clamp-3 leading-relaxed">{c.description}</p>
                  )}
                  <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" />{c.venue || 'Venue TBA'}</div>
                    <div className="flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5" />{formatDateTime(c.start_time)}</div>
                  </div>
                  <Link to={`/c/${c.id}`} className="mt-5">
                    <Button className="w-full rounded-full text-xs font-semibold tracking-wider">
                      REGISTER <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;
