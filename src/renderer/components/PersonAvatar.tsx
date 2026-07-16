import React, { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Avatar } from './ui'

/**
 * Avatar que carga la FOTO real de la persona (miniatura) si existe;
 * si no, muestra las iniciales. Para usar en cuadrículas y listas.
 */
export function PersonAvatar({
  person,
  onClick,
  size
}: {
  person: { id: number; fullName: string; photoPath?: string | null; photoThumbPath?: string | null }
  onClick?: () => void
  size?: 'lg'
}) {
  const [photo, setPhoto] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    if (person.photoThumbPath || person.photoPath) {
      api.persons.photoDataUrl(person.id).then((d) => alive && setPhoto(d))
    } else {
      setPhoto(null)
    }
    return () => {
      alive = false
    }
  }, [person.id, person.photoPath, person.photoThumbPath])

  const avatar = <Avatar dataUrl={photo} name={person.fullName || '?'} size={size} />
  if (!onClick) return avatar
  return (
    <span className="clickable" onClick={onClick} title="Ver perfil">
      {avatar}
    </span>
  )
}
