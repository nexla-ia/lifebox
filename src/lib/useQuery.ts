import { useCallback, useEffect, useState } from 'react'

type Result<T> = { data: T | null; error: { message: string } | null }

/** Busca com os quatro estados que toda tela precisa (§8): carregando, erro,
 *  vazio e conteúdo. Deliberadamente minúsculo — não vale uma biblioteca de
 *  cache enquanto ninguém precisou de cache. */
export function useQuery<T>(run: () => PromiseLike<Result<T>>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const exec = useCallback(run, deps)

  const reload = useCallback(() => {
    let cancelled = false
    setLoading(true)
    Promise.resolve(exec()).then((r) => {
      if (cancelled) return
      if (r.error) setError(r.error.message)
      else {
        setData(r.data)
        setError(null)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [exec])

  useEffect(() => reload(), [reload])

  return { data, loading, error, reload }
}
