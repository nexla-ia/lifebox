import { useEffect, useRef, useState } from 'react'
import { formatarTelefone, normalizarTelefone } from '../../lib/telefone'
import { apenasDigitos } from '../../lib/numero'
import { normalizarZip } from '../../lib/zip'
import {
  consultarZipAtendido, identificar, type CatalogoLink, type Identificacao,
} from './api'
import { nome, type Idioma, type Textos } from './i18n'
import { Aviso, BotaoPrincipal, Campo, Grupo, inputCls } from './ui'

/* Passo 1 · telas 6e (número conhecido), 6g (primeira vez), 6f (validação de
 * área) e 6m (já tem pedido na semana).
 *
 * O WhatsApp vem primeiro de propósito (§9.7): é ele que cruza a pessoa com o
 * cadastro e com a conversa. Normalizado em E.164 aqui e conferido de novo no
 * servidor — errar o telefone não dá erro visível, cria cliente duplicado e faz
 * a automação não achar o pedido de quem mandou o comprovante.
 *
 * Quem responde "entregamos aí?" é `zip_codes`, por fn_link_zip (§6.1). A
 * consulta ao api.zippopotam.us do resto do sistema NÃO entra aqui: ela serve
 * para a equipe preencher cadastro, e numa página pública seria uma dependência
 * externa no caminho de fechar pedido. A cidade vem da nossa tabela. */

export type DadosCliente = {
  telefone: string           // E.164, já normalizado
  /** §6.6 · reunião de 22/09/2026: quem retira não paga delivery, e não
   *  precisa estar em ZIP atendido — o endereço deixa de ser obrigatório. */
  fulfillment: 'delivery' | 'pickup'
  first_name: string
  last_name: string
  street_address: string
  zip_code: string
  city: string
  delivery_notes: string
  payment_method_id: string
  conhecido: boolean
}

export const CLIENTE_VAZIO: DadosCliente = {
  telefone: '', fulfillment: 'delivery', first_name: '', last_name: '', street_address: '',
  zip_code: '', city: '', delivery_notes: '', payment_method_id: '',
  conhecido: false,
}

type EstadoZip =
  | { estado: 'vazio' }
  | { estado: 'conferindo' }
  | { estado: 'atende'; city: string; rota: string }
  | { estado: 'fora' }

export function PassoIdentificacao({
  t, lang, catalogo, dados, setDados, onAvancar, onPedidoExistente, jaTemPedido,
}: {
  t: Textos
  lang: Idioma
  catalogo: CatalogoLink
  dados: DadosCliente
  setDados: (d: DadosCliente) => void
  jaTemPedido: boolean
  onAvancar: () => void
  onPedidoExistente: (p: NonNullable<Identificacao['pedidos']>) => void
}) {
  const [bruto, setBruto] = useState(dados.telefone ? formatarTelefone(dados.telefone) : '')
  const [buscando, setBuscando] = useState(false)
  const [erroTel, setErroTel] = useState<string | null>(null)
  const [zip, setZip] = useState<EstadoZip>(
    dados.zip_code && dados.city
      ? { estado: 'atende', city: dados.city, rota: '' }
      : { estado: 'vazio' },
  )
  const [editandoEndereco, setEditandoEndereco] = useState(!dados.conhecido)
  const ultimoTel = useRef<string>(dados.telefone)

  /** Identifica assim que o número fica válido — a pessoa não deve ter de
   *  apertar nada para o "Olá, {nome}" aparecer (tela 6e). */
  useEffect(() => {
    const e164 = normalizarTelefone(bruto)
    if (!e164) {
      if (bruto.replace(/\D/g, '').length >= 10) setErroTel(t.erroTelefone)
      else setErroTel(null)
      return
    }
    setErroTel(null)
    if (e164 === ultimoTel.current) return
    ultimoTel.current = e164

    let cancelado = false
    setBuscando(true)
    void identificar(e164).then(({ data, error }) => {
      if (cancelado) return
      setBuscando(false)
      if (error || !data) {
        setErroTel(error?.code === 'LB429' ? t.erroLimite : t.erroGenerico)
        return
      }
      // ter pedido na semana não interrompe mais o fluxo: a tela mostra o que
      // já existe e a pessoa decide fazer outro (reunião de 22/09/2026)
      onPedidoExistente(data.pedidos ?? [])

      if (data.conhecido) {
        setDados({
          ...dados, telefone: e164, conhecido: true,
          first_name: data.first_name ?? '',
          last_name: data.last_name ?? '',
          street_address: data.street_address ?? '',
          zip_code: data.zip_code ?? '',
          city: data.city ?? '',
          delivery_notes: data.delivery_notes ?? '',
        })
        setEditandoEndereco(false)
        if (data.zip_code) void conferirZip(data.zip_code, false)
      } else {
        setDados({ ...CLIENTE_VAZIO, telefone: e164, fulfillment: dados.fulfillment })
        setEditandoEndereco(true)
        setZip({ estado: 'vazio' })
      }
    })
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bruto])

  async function conferirZip(valor: string, gravarCidade = true) {
    const z = normalizarZip(valor)
    if (!z) { setZip({ estado: 'vazio' }); return }
    setZip({ estado: 'conferindo' })
    const { data } = await consultarZipAtendido(z)
    if (!data?.atende) { setZip({ estado: 'fora' }); return }
    setZip({ estado: 'atende', city: data.city ?? '', rota: data.rota ?? '' })
    if (gravarCidade) setDados({ ...dados, zip_code: z, city: data.city ?? '' })
  }

  const retira = dados.fulfillment === 'pickup'
  // quem retira não precisa de endereço: o pedido não vai para rota nenhuma
  const enderecoOk = retira
    || (zip.estado === 'atende' && dados.street_address.trim() !== '')
  const podeAvancar =
    Boolean(normalizarTelefone(dados.telefone)) &&
    dados.first_name.trim() !== '' &&
    enderecoOk &&
    !buscando

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[19px] font-bold text-brand">{t.p1Titulo}</h1>

      <Campo label={t.whatsapp} ajuda={t.whatsappAjuda} obrigatorio>
        <input value={bruto} onChange={(e) => setBruto(e.target.value)}
          inputMode="tel" autoComplete="tel" placeholder="(617) 555-0142"
          className={inputCls} />
      </Campo>
      {erroTel && <Aviso tom="danger">{erroTel}</Aviso>}
      {buscando && <div className="text-[12px] text-ink-muted">{t.verificando}</div>}

      {dados.conhecido && (
        <Aviso tom="ok">
          <strong>{t.ola}, {dados.first_name}! 👋</strong> {t.encontramos}
          {!retira && !editandoEndereco && dados.street_address && (
            <div className="mt-1.5">
              {t.entregaEm} {dados.street_address}
              {dados.city && `, ${dados.city}`} {dados.zip_code}
              <button onClick={() => setEditandoEndereco(true)}
                className="ml-2 underline font-semibold">
                {t.alterarEndereco}
              </button>
            </div>
          )}
        </Aviso>
      )}

      {/* em retirada não se pede endereço, então prometer que ele será usado
          para conferir a área seria pedir dado sem motivo */}
      {normalizarTelefone(dados.telefone) && !dados.conhecido && !buscando && !retira && (
        <Aviso tom="info">
          <strong>{t.primeiraVez} 👋</strong> {t.primeiraVezAjuda}
        </Aviso>
      )}

      {normalizarTelefone(dados.telefone) && !buscando && (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            <Campo label={t.nome} obrigatorio>
              <input value={dados.first_name} autoComplete="given-name"
                onChange={(e) => setDados({ ...dados, first_name: e.target.value })}
                className={inputCls} />
            </Campo>
            <Campo label={t.sobrenome}>
              <input value={dados.last_name} autoComplete="family-name"
                onChange={(e) => setDados({ ...dados, last_name: e.target.value })}
                className={inputCls} />
            </Campo>
          </div>

          <Grupo label={t.comoReceber}>
            {(['delivery', 'pickup'] as const).map((f) => (
              <button key={f} onClick={() => setDados({ ...dados, fulfillment: f })}
                aria-pressed={dados.fulfillment === f}
                aria-label={f === 'delivery' ? t.entrega : t.retirada}
                className={`flex-1 min-w-36 rounded-lg px-4 py-2.5 text-[13px] border text-left ${
                  dados.fulfillment === f
                    ? 'bg-leaf-bg border-brand text-ink font-semibold'
                    : 'bg-surface border-line-strong text-ink-2 hover:border-brand'}`}>
                <span className="block">{f === 'delivery' ? t.entrega : t.retirada}</span>
                <span className="block text-[11px] font-normal text-ink-3">
                  {f === 'delivery' ? t.entregaAjuda : t.retiradaAjuda}
                </span>
              </button>
            ))}
          </Grupo>

          {/* §6.6 quem retira não precisa de endereço nem de ZIP atendido */}
          {retira && catalogo.pickup_window && (
            <Aviso tom="info">
              🏠 <strong>{t.janelaRetirada}:</strong>{' '}
              {catalogo.pickup_window.start}–{catalogo.pickup_window.end}
            </Aviso>
          )}

          {!retira && editandoEndereco && (
            <>
              <Campo label={t.endereco} obrigatorio>
                <input value={dados.street_address} autoComplete="street-address"
                  onChange={(e) => setDados({ ...dados, street_address: e.target.value })}
                  placeholder="66 Shirley Ave" className={inputCls} />
              </Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo label={t.zip} obrigatorio>
                  <input value={dados.zip_code} inputMode="numeric" autoComplete="postal-code"
                    maxLength={5}
                    onChange={(e) => setDados({
                      ...dados, zip_code: apenasDigitos(e.target.value),
                    })}
                    onBlur={(e) => void conferirZip(e.target.value)}
                    placeholder="02151" className={inputCls} />
                </Campo>
                <Campo label={t.cidade}>
                  <input value={dados.city} readOnly
                    className={`${inputCls} bg-muted-bg text-ink-3`} />
                </Campo>
              </div>
            </>
          )}

          {!retira && zip.estado === 'conferindo' && (
            <div className="text-[12px] text-ink-muted">{t.verificando}</div>
          )}
          {!retira && zip.estado === 'atende' && (
            <Aviso tom="ok">
              ✅ <strong>{t.entregamos}</strong>
              {zip.rota && <> · {zip.rota}</>}
            </Aviso>
          )}
          {!retira && zip.estado === 'fora' && (
            <Aviso tom="danger">
              ❌ <strong>{t.naoEntregamos}</strong>
              <div className="mt-1">{t.naoEntregamosAjuda}</div>
              <div className="mt-1.5 font-semibold">💚 {t.pedidoBloqueado}</div>
            </Aviso>
          )}

          {!retira && <Campo label={`${t.notas} (${t.opcional})`}>
            <input value={dados.delivery_notes}
              onChange={(e) => setDados({ ...dados, delivery_notes: e.target.value })}
              className={inputCls} />
          </Campo>}

          {catalogo.payment_methods.length > 0 && (
            <Grupo label={t.formaPagamento}>
              {catalogo.payment_methods.map((f) => (
                <button key={f.id}
                  onClick={() => setDados({ ...dados, payment_method_id: f.id })}
                  aria-pressed={dados.payment_method_id === f.id}
                  className={`rounded-lg px-4 py-2 text-[13px] border ${
                    dados.payment_method_id === f.id
                      ? 'bg-brand border-brand text-cream font-semibold'
                      : 'bg-surface border-line-strong text-ink-2 hover:border-brand'}`}>
                  {nome(f, lang)}
                </button>
              ))}
            </Grupo>
          )}
        </>
      )}

      <BotaoPrincipal onClick={onAvancar} disabled={!podeAvancar}>
        {jaTemPedido ? t.outroPedido : t.escolherPlano}
      </BotaoPrincipal>
    </div>
  )
}
