import {useResizeHandle} from './ResizeHandle.hook';
import * as s from './ResizeHandle.styles';
import type {ResizeHandleProps} from './ResizeHandle.types';

export default function ResizeHandle(props: ResizeHandleProps) {
  const {onPointerDown, onPointerMove, onPointerUp, onPointerCancel} = useResizeHandle(props);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      title="Arrastra para cambiar el ancho · doble clic: el ancho por defecto"
      className={s.handle({edge: props.edge})}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={props.onReset}
    >
      <div className={s.line} />
      <span className={s.grip} />
    </div>
  );
}
