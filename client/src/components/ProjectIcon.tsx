import React from 'react';
import { getProjectIcon } from '../utils/projectIcons';

export interface ProjectIconProps extends React.SVGProps<SVGSVGElement> {
  icon?: string | null;
  className?: string;
  title?: string;
}

export const ProjectIcon: React.FC<ProjectIconProps> = ({
  icon,
  className = 'w-5 h-5 shrink-0',
  title,
  ...svgProps
}) => {
  const iconDef = getProjectIcon(icon);

  return (
    <svg
      viewBox="0 0 800 800"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={title || iconDef.name}
      {...svgProps}
    >
      {title && <title>{title}</title>}
      <g transform="translate(0,800) scale(0.1,-0.1)">
        <path fill={iconDef.color} d={iconDef.shapePath} />
        <path fill="#000000" d={iconDef.facePath} />
      </g>
    </svg>
  );
};
