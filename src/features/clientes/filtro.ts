import type { Cliente, StatusCliente } from './api'

export type Criterios = {
  busca: string
  status: StatusCliente | 'todos'
  rotaId: string
}

/* Função pura de propósito: a versão anterior vivia dentro do componente e
 * tinha um bug invisível — `telefone.includes('')` é sempre true, então
 * qualquer busca sem dígito (isto é, quase toda busca por nome) casava com
 * todo mundo e a lista nunca filtrava. Fora do componente, dá para testar. */
export function filtrarClientes(clientes: Cliente[], c: Criterios): Cliente[] {
  const q = c.busca.trim().toLowerCase()
  const digitos = q.replace(/\D/g, '')

  return clientes.filter((cli) => {
    if (c.status !== 'todos' && cli.status !== c.status) return false
    if (c.rotaId && cli.route_id !== c.rotaId) return false
    if (!q) return true

    const nome = `${cli.first_name} ${cli.last_name ?? ''}`.trim().toLowerCase()
    if (nome.includes(q)) return true

    // só compara telefone e ZIP quando a busca TEM dígito
    if (digitos && cli.phone_e164.replace(/\D/g, '').includes(digitos)) return true
    if (digitos && (cli.zip_code ?? '').includes(digitos)) return true

    return false
  })
}
