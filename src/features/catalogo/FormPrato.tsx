import { useRef, useState } from 'react'
import type { Dish, DishCategory } from '../../lib/types'
import { enviarFoto, salvarPrato, type DadosMenus } from './menusApi'

/* Cadastro de prato. Ref: protótipo 5e.
 *
 * PT alimenta a folha da cozinha; EN alimenta o link público (§5.5) — por isso
 * os dois são obrigatórios. Nutrição e alérgenos aparecem no cartão do prato
 * (5f, 6b) e não estavam no §7; entraram no schema por causa do protótipo. */

const CATEGORIAS: { id: DishCategory; rotulo: string }[] = [
  { id: 'classico', rotulo: 'Clássico' },
  { id: 'brasileiro', rotulo: 'Brasileiro' },
  { id: 'breakfast', rotulo: 'Breakfast' },
]

const PROTEINAS = ['frango', 'carne', 'peru', 'porco', 'seafood', 'ovos', 'vegetariano']

type Props = {
  dados: DadosMenus
  prato: Dish | null
  menuId: string
  menuNome: string
  onCancelar: () => void
  onSalvo: () => void
}

export function FormPrato({ dados, prato, menuId, menuNome, onCancelar, onSalvo }: Props) {
  const [namePt, setNamePt] = useState(prato?.name_pt ?? '')
  const [nameEn, setNameEn] = useState(prato?.name_en ?? '')
  const [descPt, setDescPt] = useState(prato?.desc_pt ?? '')
  const [descEn, setDescEn] = useState(prato?.desc_en ?? '')
  const [categoria, setCategoria] = useState<DishCategory>(prato?.category ?? 'classico')
  const [proteina, setProteina] = useState(prato?.protein_tag ?? '')
  const [cal, setCal] = useState(prato?.calories?.toString() ?? '')
  const [prot, setProt] = useState(prato?.protein_g?.toString() ?? '')
  const [carb, setCarb] = useState(prato?.carbs_g?.toString() ?? '')
  const [gord, setGord] = useState(prato?.fat_g?.toString() ?? '')
  const [foto, setFoto] = useState<string | null>(prato?.photos?.[0] ?? null)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [tagIds, setTagIds] = useState<string[]>(
    dados.tagLinks.filter((l) => l.dish_id === prato?.id).map((l) => l.tag_id),
  )
  const [alergIds, setAlergIds] = useState<string[]>(
    dados.dishAlergenos.filter((l) => l.dish_id === prato?.id).map((l) => l.allergen_id),
  )
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const inputFoto = useRef<HTMLInputElement>(null)

  const alterna = (lista: string[], set: (v: string[]) => void, id: string) =>
    set(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id])

  const numero = (v: string) => (v.trim() === '' ? null : Number(v))

  async function submeter(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!namePt.trim() || !nameEn.trim()) {
      setErro('Nome em PT e em EN são obrigatórios: a cozinha lê o PT, o cliente lê o EN.')
      return
    }
    for (const [rotulo, v] of [['Cal', cal], ['Prot', prot], ['Carbs', carb], ['Fat', gord]] as const) {
      if (v.trim() !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0)) {
        setErro(`Valor inválido em ${rotulo}: "${v}"`)
        return
      }
    }

    setSalvando(true)
    const { error, dishId } = await salvarPrato(
      {
        id: prato?.id,
        name_pt: namePt.trim(), name_en: nameEn.trim(),
        desc_pt: descPt.trim() || null, desc_en: descEn.trim() || null,
        category: categoria,
        protein_tag: proteina || null,
        calories: numero(cal), protein_g: numero(prot),
        carbs_g: numero(carb), fat_g: numero(gord),
        photos: foto ? [foto] : [],
      },
      tagIds, alergIds, menuId,
    )

    if (error) { setErro(error.message); setSalvando(false); return }

    // a foto só sobe depois de existir id de prato, para o caminho no Storage
    // nunca colidir entre dois pratos
    if (arquivo && dishId) {
      const r = await enviarFoto(arquivo, dishId)
      if (r.error) {
        setErro(`Prato salvo, mas a foto falhou: ${r.error.message}`)
        setSalvando(false)
        return
      }
      await salvarPrato(
        { id: dishId, name_pt: namePt.trim(), name_en: nameEn.trim(),
          desc_pt: descPt.trim() || null, desc_en: descEn.trim() || null,
          category: categoria, protein_tag: proteina || null,
          calories: numero(cal), protein_g: numero(prot),
          carbs_g: numero(carb), fat_g: numero(gord),
          photos: r.url ? [r.url] : [] },
        tagIds, alergIds,
      )
    }

    setSalvando(false)
    onSalvo()
  }

  const campo = 'w-full border border-line-strong rounded-lg px-3 py-2 text-[13px] bg-surface-alt outline-none focus:border-brand'
  const rotulo = 'text-[11px] font-semibold text-ink-2'

  return (
    <form onSubmit={submeter} className="px-4 py-4 bg-cream/60 border-b border-line flex flex-col gap-3.5">
      <div className="flex gap-4 items-start flex-wrap">
        <div>
          <button
            type="button"
            onClick={() => inputFoto.current?.click()}
            className="w-24 h-24 rounded-xl border border-dashed border-line-strong bg-surface-alt grid place-items-center overflow-hidden hover:border-brand"
          >
            {foto
              ? <img src={foto} alt="" className="w-full h-full object-cover" />
              : <span className="text-[10.5px] text-ink-muted text-center leading-tight">📷<br />Enviar foto</span>}
          </button>
          <input
            ref={inputFoto}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            aria-label="Foto do prato"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (!f) return
              setArquivo(f)
              setFoto(URL.createObjectURL(f))
            }}
          />
          <p className="text-[10px] text-ink-muted mt-1 w-24 leading-tight">JPG, PNG ou WebP, até 5 MB</p>
        </div>

        <div className="flex-1 min-w-64 grid grid-cols-2 gap-3">
          <label>
            <span className={rotulo}>Nome PT * <span className="font-normal text-ink-muted">· cozinha</span></span>
            <input className={campo} value={namePt} onChange={(e) => setNamePt(e.target.value)} />
          </label>
          <label>
            <span className={rotulo}>Nome EN * <span className="font-normal text-ink-muted">· link do cliente</span></span>
            <input className={campo} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </label>
          <label>
            <span className={rotulo}>Descrição PT</span>
            <input className={campo} value={descPt} onChange={(e) => setDescPt(e.target.value)} />
          </label>
          <label>
            <span className={rotulo}>Descrição EN</span>
            <input className={campo} value={descEn} onChange={(e) => setDescEn(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className={rotulo}>Categoria</span>
          <div className="flex gap-1.5 mt-1">
            {CATEGORIAS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoria(c.id)}
                className={`flex-1 rounded-lg py-2 text-[11.5px] border ${
                  categoria === c.id
                    ? 'bg-leaf-bg border-brand text-brand font-semibold'
                    : 'bg-surface border-line-strong text-ink-2'
                }`}
              >
                {c.rotulo}
              </button>
            ))}
          </div>
        </div>
        <label>
          <span className={rotulo}>Proteína</span>
          <select className={campo} value={proteina} onChange={(e) => setProteina(e.target.value)}>
            <option value="">—</option>
            {PROTEINAS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      </div>

      <div className="border-t border-line-soft pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Informação nutricional · por porção
        </span>
        <div className="grid grid-cols-4 gap-2 mt-1.5">
          {([['Cal', cal, setCal], ['Prot (g)', prot, setProt],
             ['Carbs (g)', carb, setCarb], ['Fat (g)', gord, setGord]] as const).map(([r, v, set]) => (
            <label key={r}>
              <span className="text-[10.5px] text-ink-muted font-semibold">{r}</span>
              <input
                aria-label={r}
                inputMode="numeric"
                className={`${campo} tnum`}
                value={v}
                onChange={(e) => set(e.target.value)}
              />
            </label>
          ))}
        </div>
        <p className="text-[10.5px] text-ink-muted mt-1">
          Aparece no cartão do prato, no link público. Deixe em branco se ainda não souber.
        </p>
      </div>

      <div className="border-t border-line-soft pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Tags</span>
        <div className="flex gap-1.5 flex-wrap mt-1.5">
          {dados.tags.map((t) => (
            <Pilula
              key={t.id}
              marcado={tagIds.includes(t.id)}
              onClick={() => alterna(tagIds, setTagIds, t.id)}
            >
              {t.icon} {t.label_pt}
            </Pilula>
          ))}
        </div>
      </div>

      <div className="border-t border-line-soft pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Contém · alérgenos
        </span>
        <div className="flex gap-1.5 flex-wrap mt-1.5">
          {dados.alergenos.map((a) => (
            <Pilula
              key={a.id}
              marcado={alergIds.includes(a.id)}
              onClick={() => alterna(alergIds, setAlergIds, a.id)}
            >
              {a.icon} {a.label_pt}
            </Pilula>
          ))}
        </div>
      </div>

      {erro && (
        <div role="alert" className="bg-danger-bg border border-danger-line text-danger rounded-lg px-3 py-2 text-[12.5px]">
          {erro}
        </div>
      )}

      <div className="flex justify-between items-center gap-3 flex-wrap">
        <p className="text-[11px] text-ink-muted">
          Ao salvar, o prato já entra ativo no <strong>{menuNome}</strong>.
        </p>
        <div className="flex gap-3 items-center">
          <button type="button" onClick={onCancelar} className="text-[12.5px] text-ink-3 hover:text-ink">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={salvando}
            className="bg-brand hover:bg-brand-hover disabled:opacity-60 text-cream rounded-lg px-4 py-2 text-[12.5px] font-semibold"
          >
            {salvando ? 'Salvando…' : 'Salvar prato'}
          </button>
        </div>
      </div>
    </form>
  )
}

function Pilula({
  marcado, onClick, children,
}: { marcado: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={marcado}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-[11.5px] border ${
        marcado
          ? 'bg-leaf-bg border-brand text-leaf font-semibold'
          : 'bg-surface border-line-strong text-ink-2 hover:border-brand'
      }`}
    >
      {children}
    </button>
  )
}
