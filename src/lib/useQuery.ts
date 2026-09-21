import { useCallback, useEffect, useState } from 'react'

type Result<T> = { data: T | null; error: { message: string } | null }

/** Busca com os quatro estados que toda tela precisa (§8): carregando, erro,
 *  vazio e conteúdo. Deliberadamente minúsculo — não vale uma biblioteca de
 *  cache enquanto ninguém precisou de cache.
 *
 *  `loading` é só a PRIMEIRA carga e a troca de parâmetro — aí o esqueleto faz
 *  sentido, porque o conteúdo antigo é de outra coisa. O `reload()` depois de
 *  gravar devolve `refreshing`, e a tela continua em pé: trocar tudo por
 *  esqueleto some com o formulário, perde o cursor e apaga a confirmação que
 *  acabou de aparecer. */
export function useQuery<T>(run: () => PromiseLike<Result<T>>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const exec = useCallback(run, deps)

  const buscar = useCallback(
    (comEsqueleto: boolean) => {
      let cancelled = false
      if (comEsqueleto) setLoading(true)
      else setRefreshing(true)

      Promise.resolve(exec()).then((r) => {
        if (cancelled) return
        if (r.error) setError(r.error.message)
        else {
          setData(r.data)
          setError(null)
        }
        setLoading(false)
        setRefreshing(false)
      })
      return () => {
        cancelled = true
      }
    },
    [exec],
  )

  useEffect(() => buscar(true), [buscar])

  const reload = useCallback(() => buscar(false), [buscar])

  return { data, loading, refreshing, error, reload }
}
