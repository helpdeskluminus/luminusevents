import { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { ImagePlus, Upload, Wand2, Check } from 'lucide-react';
import {
  COVER_CATEGORIES,
  COVER_TEMPLATES,
  type CoverTemplate,
  monogramOf,
  renderCoverSvg,
  svgDataUrl,
  svgToPngBlob,
  templateForName,
} from '@/lib/coverTemplates';

interface Props {
  /** Current banner/poster URL. */
  value: string;
  onChange: (url: string) => void;
  /** Event or competition name — used for the auto-generated monogram cover. */
  name?: string;
  label?: string;
}

export const CoverImageGallery = ({ value, onChange, name = '', label = 'Cover image' }: Props) => {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(COVER_CATEGORIES[0]);
  const [selected, setSelected] = useState<CoverTemplate | null>(null);
  const [withMonogram, setWithMonogram] = useState(true);
  const [busy, setBusy] = useState(false);
  const [urlDraft, setUrlDraft] = useState(value);

  const monogram = monogramOf(name);
  const templates = useMemo(() => COVER_TEMPLATES.filter((t) => t.category === category), [category]);

  const svgFor = (t: CoverTemplate) =>
    renderCoverSvg(t, withMonogram && monogram ? { label: monogram, caption: name.slice(0, 24) } : {});

  const uploadPng = async (blob: Blob) => {
    const path = `covers/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const { error } = await supabase.storage.from('event-images').upload(path, blob, { contentType: 'image/png', upsert: true });
    if (error) throw new Error(error.message);
    const { data } = supabase.storage.from('event-images').getPublicUrl(path);
    return data.publicUrl;
  };

  const applyTemplate = async (t: CoverTemplate) => {
    setBusy(true);
    try {
      const url = await uploadPng(await svgToPngBlob(svgFor(t)));
      onChange(url);
      toast.success('Cover image set');
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not set cover image');
    } finally {
      setBusy(false);
    }
  };

  const uploadOwn = async (file: File) => {
    if (!file.type.startsWith('image/')) return toast.error('Please choose an image file');
    setBusy(true);
    try {
      const path = `covers/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
      const { error } = await supabase.storage.from('event-images').upload(path, file);
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from('event-images').getPublicUrl(path);
      onChange(data.publicUrl);
      toast.success('Image uploaded');
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const generateFromName = async () => {
    if (!name.trim()) return toast.error('Enter a name first');
    const t = templateForName(name);
    setBusy(true);
    try {
      const url = await uploadPng(await svgToPngBlob(renderCoverSvg(t, { label: monogramOf(name), caption: name.slice(0, 24) })));
      onChange(url);
      toast.success('Cover generated from the name');
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate cover');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
          {value ? (
            <img src={value} alt="Selected cover" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground"><ImagePlus className="h-5 w-5" /></div>
          )}
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) setUrlDraft(value); }}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="rounded-full text-[11px] font-semibold tracking-wider">
              {value ? 'CHANGE COVER' : 'CHOOSE COVER'}
            </Button>
          </DialogTrigger>
          {value && (
            <Button type="button" variant="ghost" size="sm" className="rounded-full text-[11px]" onClick={() => onChange('')}>
              Remove
            </Button>
          )}
          <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="font-heading">Choose a cover</DialogTitle></DialogHeader>
            <Tabs defaultValue="templates">
              <TabsList>
                <TabsTrigger value="templates">Choose a template</TabsTrigger>
                <TabsTrigger value="upload">Upload your own</TabsTrigger>
                <TabsTrigger value="url">Paste a URL</TabsTrigger>
              </TabsList>

              <TabsContent value="templates" className="mt-4 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  {COVER_CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      className={`rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide transition-colors ${
                        c === category ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary/50'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={withMonogram} onChange={(e) => setWithMonogram(e.target.checked)} />
                    Show monogram {monogram ? `“${monogram}”` : '(enter a name first)'}
                  </label>
                  <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={generateFromName} className="rounded-full text-[11px] font-semibold tracking-wider">
                    <Wand2 className="mr-1.5 h-3.5 w-3.5" /> GENERATE FROM NAME
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {templates.map((t) => {
                    const isSel = selected?.id === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={busy}
                        onClick={() => { setSelected(t); void applyTemplate(t); }}
                        className={`relative aspect-square overflow-hidden rounded-xl border-2 transition-all ${isSel ? 'border-primary' : 'border-transparent hover:border-primary/50'}`}
                      >
                        <img src={svgDataUrl(svgFor(t))} alt={`${t.category} cover template`} className="h-full w-full object-cover" />
                        {isSel && (
                          <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-1 text-primary-foreground"><Check className="h-3 w-3" /></span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Original artwork generated in-app — square 1:1, safe margins, nothing important in the corners.
                </p>
              </TabsContent>

              <TabsContent value="upload" className="mt-4">
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border p-8 text-xs text-muted-foreground hover:border-primary/50">
                  {busy ? 'Uploading…' : <><Upload className="h-3.5 w-3.5" /> Choose an image from your device</>}
                  <input type="file" accept="image/*" className="hidden" disabled={busy}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadOwn(f); e.target.value = ''; }} />
                </label>
              </TabsContent>

              <TabsContent value="url" className="mt-4 space-y-3">
                <Input placeholder="https://…" value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} />
                <Button type="button" className="rounded-full text-xs font-semibold tracking-wider" onClick={() => { onChange(urlDraft.trim()); setOpen(false); }}>
                  USE THIS URL
                </Button>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};
